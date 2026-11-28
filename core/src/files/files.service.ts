import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { resolve } from 'path';

import { PrismaService } from '../prisma.service';

/** Durée de vie d'un fichier en transit et de son lien de téléchargement. */
export const FILE_TTL_MS = 15 * 60_000;

@Injectable()
export class FilesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Files');
  readonly dir = resolve(process.env.FILES_DIR ?? './storage');
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.timer = setInterval(() => this.cleanup().catch((e) => this.log.error(e)), 5 * 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async register(deviceId: string, file: Express.Multer.File) {
    const blob = await this.prisma.fileBlob.create({
      data: {
        deviceId,
        name: file.originalname.slice(0, 200),
        mime: file.mimetype || 'application/octet-stream',
        size: file.size,
        path: file.path,
        expiresAt: new Date(Date.now() + FILE_TTL_MS),
      },
      select: { id: true, name: true, mime: true, size: true, expiresAt: true },
    });
    return blob;
  }

  private sign(id: string, exp: number) {
    return createHmac('sha256', process.env.FILES_SECRET!).update(`${id}.${exp}`).digest('base64url');
  }

  /** Lien de téléchargement signé, sans jeton de compte (utilisable par un lecteur d'image). */
  signedPath(id: string) {
    const exp = Date.now() + FILE_TTL_MS;
    return `/files/${id}?exp=${exp}&sig=${this.sign(id, exp)}`;
  }

  async resolveDownload(id: string, exp: string, sig: string) {
    const expNum = Number(exp);
    const expected = Buffer.from(this.sign(id, expNum));
    const given = Buffer.from(sig ?? '');
    if (!expNum || expNum < Date.now() || expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new UnauthorizedException('Lien expiré ou invalide');
    }
    const blob = await this.prisma.fileBlob.findUnique({ where: { id } });
    if (!blob || blob.expiresAt < new Date()) throw new NotFoundException('Fichier expiré');
    return blob;
  }

  /** Fichier déposé par l'app pour un PC : seul l'agent de ce PC pourra le retirer. */
  async registerForDevice(userId: string, deviceId: string, file: Express.Multer.File) {
    const device = await this.prisma.device.findFirst({ where: { id: deviceId, userId, revokedAt: null } });
    if (!device) {
      await unlink(file.path).catch(() => {});
      throw new NotFoundException('Appareil introuvable');
    }
    return this.register(deviceId, file);
  }

  async forAgent(id: string, deviceId: string) {
    const blob = await this.prisma.fileBlob.findFirst({ where: { id, deviceId } });
    if (!blob || blob.expiresAt < new Date()) throw new NotFoundException('Fichier expiré');
    return blob;
  }

  /** Vérifie qu'un fichier appartient bien au PC qui le cite dans un résultat. */
  async belongsTo(id: string, deviceId: string) {
    return !!(await this.prisma.fileBlob.findFirst({ where: { id, deviceId }, select: { id: true } }));
  }

  async cleanup() {
    const expired = await this.prisma.fileBlob.findMany({ where: { expiresAt: { lt: new Date() } } });
    for (const f of expired) {
      await unlink(f.path).catch(() => {});
      await this.prisma.fileBlob.delete({ where: { id: f.id } }).catch(() => {});
    }
    if (expired.length) this.log.log(`${expired.length} fichier(s) expiré(s) supprimé(s)`);
  }
}
