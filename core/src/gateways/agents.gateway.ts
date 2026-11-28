import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';

import { CommandsService } from '../commands/commands.service';
import type { AgentUpdate } from '../commands/commands.service';
import { DevicesService } from '../devices/devices.service';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Connexion SORTANTE des agents PC (aucun port ouvert côté PC).
 * Auth : `io(url + '/agents', { auth: { token } })` avec le jeton d'appareil.
 */
@WebSocketGateway({ namespace: '/agents', cors: false, maxHttpBufferSize: 4e6, pingInterval: 20_000, pingTimeout: 20_000 })
export class AgentsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger('Agents');

  constructor(
    private readonly devices: DevicesService,
    private readonly commands: CommandsService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(ns: Namespace) {
    this.realtime.registerAgents(ns);
  }

  async handleConnection(client: Socket) {
    const token = typeof client.handshake.auth?.token === 'string' ? client.handshake.auth.token : undefined;
    const device = await this.devices.authenticateAgent(token);
    if (!device) {
      client.emit('auth:error', { message: 'Jeton d’appareil invalide ou révoqué' });
      client.disconnect(true);
      return;
    }
    // Une seule connexion active par PC : l'ancienne est fermée.
    this.realtime.kickDevice(device.id);
    client.data.deviceId = device.id;
    client.data.userId = device.userId;
    await client.join(`device:${device.id}`);
    await this.devices.setPresence(device.id, true);
    this.log.log(`${device.name} connecté`);
    client.emit('hello', { deviceId: device.id, name: device.name });
  }

  async handleDisconnect(client: Socket) {
    const deviceId: string | undefined = client.data.deviceId;
    if (!deviceId) return;
    // Laisse le temps à une reconnexion immédiate de prendre le relais.
    setTimeout(async () => {
      if (this.realtime.isOnline(deviceId)) return;
      await this.devices.setPresence(deviceId, false).catch(() => {});
      await this.commands.failInFlight(deviceId).catch(() => {});
    }, 1500);
  }

  @SubscribeMessage('command:update')
  async onCommandUpdate(@ConnectedSocket() client: Socket, @MessageBody() update: AgentUpdate) {
    if (!client.data.deviceId || typeof update?.id !== 'string') return { ok: false };
    await this.commands.handleAgentUpdate(client.data.deviceId, update);
    return { ok: true };
  }

  /** Bureau à distance : images de l'écran et réponses de l'agent, relayées telles quelles au téléphone. */
  @SubscribeMessage('remote:frame')
  onRemoteFrame(@ConnectedSocket() client: Socket, @MessageBody() frame: { seq: number; data: Buffer }) {
    const { deviceId, userId } = client.data;
    if (!deviceId || !frame?.data) return;
    this.realtime.toUser(userId, 'remote:frame', { id: deviceId, seq: frame.seq, data: frame.data });
  }

  @SubscribeMessage('remote:ready')
  onRemoteReady(@ConnectedSocket() client: Socket, @MessageBody() info: { width: number; height: number }) {
    const { deviceId, userId } = client.data;
    if (deviceId) this.realtime.toUser(userId, 'remote:ready', { id: deviceId, ...info });
  }

  @SubscribeMessage('remote:error')
  onRemoteError(@ConnectedSocket() client: Socket, @MessageBody() err: { message: string }) {
    const { deviceId, userId } = client.data;
    if (deviceId) this.realtime.toUser(userId, 'remote:error', { id: deviceId, message: String(err?.message ?? 'Erreur') });
  }

  /** Métriques envoyées périodiquement par l'agent (CPU, RAM, disque, batterie…). */
  @SubscribeMessage('telemetry')
  onTelemetry(@ConnectedSocket() client: Socket, @MessageBody() data: Record<string, unknown>) {
    const { deviceId, userId } = client.data;
    if (!deviceId || typeof data !== 'object' || data === null) return;
    this.realtime.setTelemetry(deviceId, data);
    this.realtime.toUser(userId, 'device:telemetry', { id: deviceId, at: new Date().toISOString(), data });
  }
}
