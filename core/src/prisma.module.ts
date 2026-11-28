import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/** Une seule connexion à la base, partagée par tous les modules. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
