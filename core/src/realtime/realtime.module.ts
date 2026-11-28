import { Global, Module } from '@nestjs/common';

import { RealtimeService } from './realtime.service';

/** Registre temps réel partagé (les passerelles vivent dans GatewaysModule). */
@Global()
@Module({
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
