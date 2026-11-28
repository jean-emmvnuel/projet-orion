import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayInit, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';

import { DevicesService } from '../devices/devices.service';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Canal temps réel de l'app : présence des PC, télémétrie, avancement des commandes.
 * Auth : `io(url + '/app', { auth: { token: <JWT> } })`.
 */
@WebSocketGateway({ namespace: '/app', cors: { origin: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean), credentials: true } })
export class AppGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly log = new Logger('App');

  constructor(
    private readonly jwt: JwtService,
    private readonly realtime: RealtimeService,
    private readonly devices: DevicesService,
  ) {}

  afterInit(ns: Namespace) {
    this.realtime.registerApp(ns);
  }

  async handleConnection(client: Socket) {
    try {
      const token = String(client.handshake.auth?.token ?? '');
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      client.data.userId = payload.sub;
      await client.join(`user:${payload.sub}`);
    } catch {
      client.emit('auth:error', { message: 'Session expirée, reconnecte-toi' });
      client.disconnect(true);
    }
  }

  /**
   * Bureau à distance : le téléphone pilote l'écran en direct d'un de SES PC.
   * Ces messages ne passent pas par l'historique (des dizaines par seconde) ; la propriété
   * de l'appareil est vérifiée une fois puis mémorisée pour la connexion.
   */
  private async relay(client: Socket, event: string, msg: { deviceId?: string } & Record<string, unknown>) {
    const userId: string | undefined = client.data.userId;
    const deviceId = typeof msg?.deviceId === 'string' ? msg.deviceId : undefined;
    if (!userId || !deviceId) return { ok: false, error: 'Appareil manquant' };
    const owned: Set<string> = (client.data.remoteDevices ??= new Set<string>());
    if (!owned.has(deviceId)) {
      try {
        await this.devices.get(userId, deviceId);
      } catch {
        return { ok: false, error: 'Appareil introuvable' };
      }
      owned.add(deviceId);
    }
    const { deviceId: _omit, ...payload } = msg;
    return this.realtime.toDevice(deviceId, event, payload) ? { ok: true } : { ok: false, error: 'PC hors ligne' };
  }

  @SubscribeMessage('remote:start')
  onRemoteStart(@ConnectedSocket() c: Socket, @MessageBody() m: { deviceId?: string; quality?: string }) {
    this.log.log(`Écran en direct demandé (${m?.quality ?? 'equilibre'})`);
    return this.relay(c, 'remote:start', m);
  }

  @SubscribeMessage('remote:stop')
  onRemoteStop(@ConnectedSocket() c: Socket, @MessageBody() m: { deviceId?: string }) {
    return this.relay(c, 'remote:stop', m);
  }

  @SubscribeMessage('remote:ack')
  onRemoteAck(@ConnectedSocket() c: Socket, @MessageBody() m: { deviceId?: string; seq?: number }) {
    return this.relay(c, 'remote:ack', m);
  }

  @SubscribeMessage('remote:input')
  onRemoteInput(@ConnectedSocket() c: Socket, @MessageBody() m: { deviceId?: string; t?: string }) {
    return this.relay(c, 'remote:input', m);
  }
}
