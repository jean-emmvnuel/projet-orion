import { Module } from '@nestjs/common';

import { RealtimeModule } from '../realtime/realtime.module';
import { DeviceTokenGuard } from './device-token.guard';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [RealtimeModule],
  controllers: [DevicesController],
  providers: [DevicesService, DeviceTokenGuard],
  exports: [DevicesService, DeviceTokenGuard],
})
export class DevicesModule {}
