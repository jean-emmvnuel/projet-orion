import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Post, Query, Request, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { resolve } from 'path';

import { DeviceTokenGuard } from '../devices/device-token.guard';
import { FilesService } from './files.service';

const MAX_UPLOAD = 200 * 1024 * 1024; // 200 Mo

@ApiTags('Fichiers')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** L'agent dépose un fichier (capture, document) ; renvoie son identifiant. */
  @UseGuards(DeviceTokenGuard)
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD },
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, resolve(process.env.FILES_DIR ?? './storage')),
        filename: (_req, _file, cb) => cb(null, randomUUID()),
      }),
    }),
  )
  async upload(@Request() req, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Aucun fichier reçu (champ « file »)');
    return this.files.register(req.device.id, file);
  }

  /** L'agent retire un fichier que l'app a déposé pour lui. */
  @UseGuards(DeviceTokenGuard)
  @Get(':id/agent')
  async agentDownload(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const blob = await this.files.forAgent(id, req.device.id);
    res.setHeader('Content-Type', blob.mime);
    res.sendFile(blob.path);
  }

  /** Téléchargement par lien signé et éphémère. */
  @Get(':id')
  async download(@Param('id', ParseUUIDPipe) id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const blob = await this.files.resolveDownload(id, exp, sig);
    res.setHeader('Content-Type', blob.mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(blob.name)}`);
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.sendFile(blob.path);
  }
}
