import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../auth/jwt.auth.guard';
import { DeviceTokenGuard } from './device-token.guard';
import { DevicesService } from './devices.service';
import { PairDto } from './dto/pair.dto';
import { RenameDeviceDto } from './dto/rename.dto';

@ApiTags('Appareils')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get()
  list(@Request() req) {
    return this.devices.list(req.user.sub);
  }

  /** L'app demande un code à afficher pour associer un nouveau PC. */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('pairing-codes')
  createPairingCode(@Request() req) {
    return this.devices.createPairingCode(req.user.sub);
  }

  /** L'agent PC échange le code contre son jeton. Strictement limité contre le forçage. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('pair')
  pair(@Body() dto: PairDto) {
    return this.devices.pair(dto);
  }

  /** L'agent PC modifie son propre nom (jeton d'appareil). Déclarée avant `:id`. */
  @ApiBearerAuth()
  @UseGuards(DeviceTokenGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Patch('self')
  renameSelf(@Request() req, @Body() dto: RenameDeviceDto) {
    return this.devices.renameSelf(req.device, dto.name);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  get(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.devices.get(req.user.sub, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  rename(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RenameDeviceDto) {
    return this.devices.rename(req.user.sub, id, dto.name);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  revoke(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.devices.revoke(req.user.sub, id);
  }
}
