import { Module } from '@nestjs/common';

import { CommandsModule } from '../commands/commands.module';
import { DevicesModule } from '../devices/devices.module';
import { AgentsGateway } from './agents.gateway';
import { AppGateway } from './app.gateway';

@Module({
  imports: [DevicesModule, CommandsModule],
  providers: [AgentsGateway, AppGateway],
})
export class GatewaysModule {}
