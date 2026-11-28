import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length, Matches } from 'class-validator';

export class PairDto {
  @ApiProperty({ example: '482913', description: 'Code à 6 chiffres affiché dans l’app' })
  @Matches(/^\d{6}$/, { message: 'Le code doit contenir 6 chiffres' })
  code: string;

  @ApiProperty({ example: 'Atelier' })
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiProperty({ enum: ['linux', 'macos', 'windows'] })
  @IsIn(['linux', 'macos', 'windows'])
  os: 'linux' | 'macos' | 'windows';

  @ApiProperty({ example: 'Ubuntu 26.04 LTS' })
  @IsString()
  @Length(1, 80)
  osVersion: string;

  @ApiProperty({ example: 'pc-de-jean' })
  @IsString()
  @Length(1, 120)
  hostname: string;
}
