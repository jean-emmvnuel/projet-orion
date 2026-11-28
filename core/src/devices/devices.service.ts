import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'crypto';

import { PrismaService } from '../prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PairDto } from './dto/pair.dto';

const PAIRING_TTL_MS = 10 * 60_000;

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** Vue publique d'un appareil (jamais l'empreinte du jeton). */
const publicDevice = {
  id: true,
  name: true,
  os: true,
  osVersion: true,
  hostname: true,
  online: true,
  lastSeenAt: true,
  createdAt: true,
} as const;

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(userId: string) {
    const devices = await this.prisma.device.findMany({
      where: { userId, revokedAt: null },
      select: publicDevice,
      orderBy: { createdAt: 'asc' },
    });
    return devices.map((d) => ({ ...d, online: this.realtime.isOnline(d.id), telemetry: this.realtime.getTelemetry(d.id) }));
  }

  async get(userId: string, id: string) {
    const d = await this.prisma.device.findFirst({ where: { id, userId, revokedAt: null }, select: publicDevice });
    if (!d) throw new NotFoundException('Appareil introuvable');
    return { ...d, online: this.realtime.isOnline(d.id), telemetry: this.realtime.getTelemetry(d.id) };
  }

  /** Code à 6 chiffres, usage unique, valable 10 minutes. Les anciens codes non utilisés sont annulés. */
  async createPairingCode(userId: string) {
    await this.prisma.pairingCode.deleteMany({ where: { userId, usedAt: null } });
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
      try {
        await this.prisma.pairingCode.create({ data: { userId, codeHash: sha256(code), expiresAt } });
        return { code, expiresAt };
      } catch {
        // Collision improbable avec un code d'un autre compte : on retire un code.
      }
    }
    throw new BadRequestException('Impossible de générer un code, réessaie.');
  }

  /** Appelé par l'agent avec le code saisi : crée l'appareil et renvoie son jeton (une seule fois). */
  async pair(dto: PairDto) {
    const pairing = await this.prisma.pairingCode.findUnique({ where: { codeHash: sha256(dto.code) } });
    if (!pairing || pairing.usedAt || pairing.expiresAt < new Date()) {
      throw new UnauthorizedException('Code invalide ou expiré. Génère un nouveau code dans l’app.');
    }
    const token = randomBytes(32).toString('base64url');
    const device = await this.prisma.$transaction(async (tx) => {
      await tx.pairingCode.update({ where: { id: pairing.id }, data: { usedAt: new Date() } });
      return tx.device.create({
        data: {
          userId: pairing.userId,
          name: dto.name,
          os: dto.os,
          osVersion: dto.osVersion,
          hostname: dto.hostname,
          tokenHash: sha256(token),
        },
        select: publicDevice,
      });
    });
    this.realtime.toUser(pairing.userId, 'device:paired', device);
    return { device, token };
  }

  async rename(userId: string, id: string, name: string) {
    await this.get(userId, id);
    return this.applyName(userId, id, name);
  }

  /** L'agent renomme son propre appareil (depuis l'app desktop). */
  async renameSelf(device: { id: string; userId: string }, name: string) {
    return this.applyName(device.userId, device.id, name);
  }

  private async applyName(userId: string, id: string, name: string) {
    const d = await this.prisma.device.update({ where: { id }, data: { name: name.trim() }, select: publicDevice });
    this.realtime.toUser(userId, 'device:updated', { id: d.id, name: d.name });
    return d;
  }

  /** Dissocie un PC : son jeton ne marche plus et sa connexion est coupée. */
  async revoke(userId: string, id: string) {
    await this.get(userId, id);
    await this.prisma.device.update({ where: { id }, data: { revokedAt: new Date(), online: false } });
    this.realtime.kickDevice(id);
    return { ok: true };
  }

  /** Authentifie un agent par son jeton. */
  async authenticateAgent(token: string | undefined) {
    if (!token) return null;
    return this.prisma.device.findFirst({ where: { tokenHash: sha256(token), revokedAt: null } });
  }

  async setPresence(deviceId: string, online: boolean) {
    const d = await this.prisma.device.update({
      where: { id: deviceId },
      data: { online, lastSeenAt: new Date() },
      select: { id: true, userId: true, online: true, lastSeenAt: true },
    });
    this.realtime.toUser(d.userId, 'device:presence', { id: d.id, online: d.online, lastSeenAt: d.lastSeenAt });
    return d;
  }
}
