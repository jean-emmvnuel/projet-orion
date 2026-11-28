import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional } from 'class-validator';

import { ACTIONS } from '../commands.service';

export class CreateCommandDto {
  @ApiProperty({ enum: Object.keys(ACTIONS), example: 'status' })
  @IsIn(Object.keys(ACTIONS))
  action: string;

  @ApiProperty({ required: false, example: { path: '~/Documents' } })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}
