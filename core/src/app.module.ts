import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { utilities as nestWinstonModuleUtilities, WinstonModule } from 'nest-winston';
import * as winston from 'winston';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CommandsModule } from './commands/commands.module';
import { DevicesModule } from './devices/devices.module';
import { FilesModule } from './files/files.module';
import { GatewaysModule } from './gateways/gateways.module';
import { PrismaModule } from './prisma.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    RealtimeModule,
    DevicesModule,
    FilesModule,
    CommandsModule,
    GatewaysModule,
    WinstonModule.forRoot({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.ms(),
            nestWinstonModuleUtilities.format.nestLike('ORION', { colors: true, prettyPrint: true }),
          ),
        }),
        new winston.transports.File({
          filename: 'error.log',
          level: 'error',
          format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
        }),
      ],
    }),
    // Limitation de débit : large pour l'app ; les routes sensibles ont leur propre limite (@Throttle).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
