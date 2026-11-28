import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

import { DevicesService } from './devices.service';

/** Authentifie un agent PC par son jeton (en-tête Authorization: Bearer <jeton>). */
@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(private readonly devices: DevicesService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const device = await this.devices.authenticateAgent(token);
    if (!device) throw new UnauthorizedException('Jeton d’appareil invalide');
    req.device = device;
    return true;
  }
}
