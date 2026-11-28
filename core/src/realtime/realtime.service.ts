import { Injectable } from '@nestjs/common';
import type { Namespace } from 'socket.io';

/**
 * Registre des deux espaces temps réel, pour émettre depuis n'importe quel service
 * sans dépendance circulaire avec les passerelles.
 *  - /agents : un salon par PC   → `device:<id>`
 *  - /app    : un salon par compte → `user:<id>`
 */
@Injectable()
export class RealtimeService {
  private agents?: Namespace;
  private app?: Namespace;
  /** Dernière télémétrie connue de chaque PC (mémoire vive : elle n'a de sens qu'en direct). */
  private telemetry = new Map<string, { at: string; data: Record<string, unknown> }>();

  registerAgents(ns: Namespace) {
    this.agents = ns;
  }

  registerApp(ns: Namespace) {
    this.app = ns;
  }

  /** Envoie un évènement à l'agent d'un PC. Retourne false si le PC n'est pas connecté. */
  toDevice(deviceId: string, event: string, payload: unknown): boolean {
    const room = `device:${deviceId}`;
    if (!this.agents || !this.agents.adapter.rooms.get(room)?.size) return false;
    this.agents.to(room).emit(event, payload);
    return true;
  }

  isOnline(deviceId: string) {
    return !!this.agents?.adapter.rooms.get(`device:${deviceId}`)?.size;
  }

  /** Déconnecte l'agent d'un PC (appareil dissocié). */
  kickDevice(deviceId: string) {
    this.agents?.in(`device:${deviceId}`).disconnectSockets(true);
  }

  toUser(userId: string, event: string, payload: unknown) {
    this.app?.to(`user:${userId}`).emit(event, payload);
  }

  setTelemetry(deviceId: string, data: Record<string, unknown>) {
    this.telemetry.set(deviceId, { at: new Date().toISOString(), data });
  }

  getTelemetry(deviceId: string) {
    return this.telemetry.get(deviceId) ?? null;
  }
}
