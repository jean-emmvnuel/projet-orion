import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { CommandStatus, Prisma } from '../generated/prisma/index.js';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Catalogue des actions qu'un agent sait exécuter, avec leur délai maximal.
 * Toute autre action est refusée par le Core avant d'atteindre le PC.
 */
export const ACTIONS: Record<string, { timeoutMs: number }> = {
  capabilities: { timeoutMs: 10_000 },
  status: { timeoutMs: 15_000 },
  screenshot: { timeoutMs: 45_000 },
  lock: { timeoutMs: 15_000 },
  unlock: { timeoutMs: 15_000 },
  standby: { timeoutMs: 15_000 },
  sleep: { timeoutMs: 15_000 },
  notify: { timeoutMs: 15_000 },
  'files.list': { timeoutMs: 20_000 },
  'files.search': { timeoutMs: 30_000 },
  'files.get': { timeoutMs: 120_000 },
  'files.zip': { timeoutMs: 180_000 },
  'files.receive': { timeoutMs: 180_000 },
  'files.open': { timeoutMs: 15_000 },
  'clipboard.get': { timeoutMs: 15_000 },
  'clipboard.set': { timeoutMs: 15_000 },
  'open.url': { timeoutMs: 15_000 },
  volume: { timeoutMs: 10_000 },
  media: { timeoutMs: 10_000 },
  power: { timeoutMs: 15_000 },
  'apps.list': { timeoutMs: 15_000 },
  'apps.open': { timeoutMs: 15_000 },
  // Clavier / navigation : la toute première fois, le PC affiche une autorisation à accepter.
  web: { timeoutMs: 130_000 },
  keys: { timeoutMs: 130_000 },
  type: { timeoutMs: 130_000 },
  remote: { timeoutMs: 10_000 },
};

const FINAL: CommandStatus[] = ['done', 'failed', 'timeout'];

export interface AgentUpdate {
  id: string;
  status: 'running' | 'done' | 'failed';
  result?: Record<string, unknown>;
  error?: string;
}

type CommandView = Awaited<ReturnType<CommandsService['get']>>;

@Injectable()
export class CommandsService {
  private readonly log = new Logger('Commands');
  /** Requêtes HTTP qui attendent le résultat d'une commande (`?wait=1`). */
  private waiters = new Map<string, ((c: CommandView) => void)[]>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly files: FilesService,
  ) {}

  private select = {
    id: true,
    deviceId: true,
    action: true,
    params: true,
    status: true,
    result: true,
    error: true,
    createdAt: true,
    finishedAt: true,
  } as const;

  async create(userId: string, deviceId: string, action: string, params: Record<string, unknown> = {}) {
    const spec = ACTIONS[action];
    if (!spec) throw new BadRequestException(`Action inconnue : ${action}`);
    const device = await this.prisma.device.findFirst({ where: { id: deviceId, userId, revokedAt: null } });
    if (!device) throw new NotFoundException('Appareil introuvable');

    const cmd = await this.prisma.command.create({
      data: { userId, deviceId, action, params: params as Prisma.InputJsonValue },
      select: this.select,
    });

    const delivered = this.realtime.toDevice(deviceId, 'command', { id: cmd.id, action, params });
    if (!delivered) {
      return this.finish(userId, cmd.id, 'failed', undefined, `${device.name} est hors ligne`);
    }
    await this.prisma.command.update({ where: { id: cmd.id }, data: { status: 'sent' } });
    this.timers.set(
      cmd.id,
      setTimeout(() => this.finish(userId, cmd.id, 'timeout', undefined, 'Le PC n’a pas répondu à temps'), spec.timeoutMs),
    );
    const view = { ...cmd, status: 'sent' as CommandStatus };
    this.realtime.toUser(userId, 'command:update', view);
    return view;
  }

  /** Attend la fin d'une commande (ou son délai), pour les appels simples depuis l'app. */
  wait(id: string, current: CommandView): Promise<CommandView> {
    if (FINAL.includes(current.status)) return Promise.resolve(current);
    return new Promise((resolve) => {
      const list = this.waiters.get(id) ?? [];
      list.push(resolve);
      this.waiters.set(id, list);
    });
  }

  /** Mise à jour envoyée par l'agent (en cours / terminé / échec). */
  async handleAgentUpdate(deviceId: string, update: AgentUpdate) {
    const cmd = await this.prisma.command.findFirst({ where: { id: update.id, deviceId } });
    if (!cmd || FINAL.includes(cmd.status)) return;
    if (update.status === 'running') {
      const view = await this.prisma.command.update({ where: { id: cmd.id }, data: { status: 'running' }, select: this.select });
      this.realtime.toUser(cmd.userId, 'command:update', view);
      return;
    }
    let result = update.result;
    // Un fichier cité dans le résultat devient un lien signé, s'il appartient bien à ce PC.
    const fileId = typeof result?.fileId === 'string' ? result.fileId : undefined;
    if (fileId && (await this.files.belongsTo(fileId, deviceId))) {
      result = { ...result, url: this.files.signedPath(fileId) };
    }
    await this.finish(cmd.userId, cmd.id, update.status === 'done' ? 'done' : 'failed', result, update.error?.slice(0, 500));
  }

  private async finish(userId: string, id: string, status: CommandStatus, result?: Record<string, unknown>, error?: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const current = await this.prisma.command.findUnique({ where: { id }, select: { status: true } });
    if (!current || FINAL.includes(current.status)) return this.get(userId, id);
    const view = await this.prisma.command.update({
      where: { id },
      data: { status, result: (result ?? undefined) as Prisma.InputJsonValue | undefined, error, finishedAt: new Date() },
      select: this.select,
    });
    if (status !== 'done') this.log.warn(`Commande ${id} : ${status} (${error ?? ''})`);
    this.realtime.toUser(userId, 'command:update', view);
    this.waiters.get(id)?.forEach((r) => r(view));
    this.waiters.delete(id);
    return view;
  }

  async get(userId: string, id: string) {
    const cmd = await this.prisma.command.findFirst({ where: { id, userId }, select: this.select });
    if (!cmd) throw new NotFoundException('Commande introuvable');
    return cmd;
  }

  list(userId: string, opts: { deviceId?: string; limit?: number }) {
    return this.prisma.command.findMany({
      where: { userId, ...(opts.deviceId ? { deviceId: opts.deviceId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
      select: { ...this.select, device: { select: { name: true, os: true } } },
    });
  }

  /** Un PC se déconnecte : ses commandes en vol échouent tout de suite. */
  async failInFlight(deviceId: string) {
    const inflight = await this.prisma.command.findMany({ where: { deviceId, status: { in: ['sent', 'running'] } } });
    for (const c of inflight) await this.finish(c.userId, c.id, 'failed', undefined, 'Le PC s’est déconnecté');
  }
}
