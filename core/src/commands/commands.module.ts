import { Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module';
import { CommandsController } from './commands.controller';
import { CommandsService } from './commands.service';

@Module({
  imports: [FilesModule],
  controllers: [CommandsController],
  providers: [CommandsService],
  exports: [CommandsService],
})
export class CommandsModule {}
