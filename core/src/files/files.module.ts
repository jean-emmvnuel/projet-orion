import { Module } from '@nestjs/common';

import { DevicesModule } from '../devices/devices.module';
import { DeviceFilesController } from './device-files.controller';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [DevicesModule],
  controllers: [FilesController, DeviceFilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
