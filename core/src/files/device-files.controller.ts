import { BadRequestException, Controller, Param, ParseUUIDPipe, Post, Request, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { resolve } from 'path';

import { JwtAuthGuard } from '../auth/jwt.auth.guard';
import { FilesService } from './files.service';

/** L'app dépose un fichier (photo, document) destiné à un PC ; l'agent le récupère ensuite. */
@ApiTags('Fichiers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('devices')
export class DeviceFilesController {
  constructor(private readonly files: FilesService) {}

  @Post(':id/files')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 200 * 1024 * 1024 },
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, resolve(process.env.FILES_DIR ?? './storage')),
        filename: (_req, _file, cb) => cb(null, randomUUID()),
      }),
    }),
  )
  upload(@Request() req, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Aucun fichier reçu (champ « file »)');
    return this.files.registerForDevice(req.user.sub, id, file);
  }
}
