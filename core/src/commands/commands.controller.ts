import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt.auth.guard';
import { CommandsService } from './commands.service';
import { CreateCommandDto } from './dto/create-command.dto';

@ApiTags('Commandes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class CommandsController {
  constructor(private readonly commands: CommandsService) {}

  /**
   * Envoie une action à un PC. Avec `?wait=1`, la réponse arrive une fois l'action terminée
   * (ou expirée) ; sinon l'app suit l'avancement via l'évènement temps réel `command:update`.
   */
  @ApiQuery({ name: 'wait', required: false })
  @Post('devices/:id/commands')
  async create(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCommandDto, @Query('wait') wait?: string) {
    const cmd = await this.commands.create(req.user.sub, id, dto.action, dto.params);
    return wait === '1' || wait === 'true' ? this.commands.wait(cmd.id, cmd) : cmd;
  }

  /** Historique (écran « Activité »). */
  @ApiQuery({ name: 'deviceId', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @Get('commands')
  list(@Request() req, @Query('deviceId') deviceId?: string, @Query('limit') limit?: string) {
    return this.commands.list(req.user.sub, { deviceId, limit: limit ? Number(limit) : undefined });
  }

  @Get('commands/:id')
  get(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.commands.get(req.user.sub, id);
  }
}
