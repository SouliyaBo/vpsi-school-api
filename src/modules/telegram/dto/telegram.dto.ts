import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** What the profile screen shows about this account's link. */
export class TelegramLinkStatusDto {
  @ApiProperty({ description: 'False when the school has no bot configured' })
  available: boolean;

  @ApiProperty()
  linked: boolean;

  @ApiPropertyOptional({ nullable: true })
  linkedAt: string | null;
}

/** A code to carry to the bot, and the ready-made link that carries it. */
export class TelegramLinkCodeDto extends TelegramLinkStatusDto {
  @ApiProperty({ example: '481920' })
  code: string;

  @ApiProperty({ description: 'ISO timestamp; the code is refused after this' })
  expiresAt: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Deep link that fills the code in for the person; null if the bot is unnamed',
    example: 'https://t.me/vpsi_school_bot?start=481920',
  })
  deepLink: string | null;
}
