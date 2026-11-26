import { IsNotEmpty, IsObject, IsString } from 'class-validator';

export class WebhookEventDto {
  @IsString()
  @IsNotEmpty()
  eventId: string;

  @IsString()
  @IsNotEmpty()
  type: string;

  @IsObject()
  data: Record<string, any>;
}
