import { Controller, Post, Get, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhookEventDto } from './webhook.dto';

@Controller()
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('webhooks')
  @HttpCode(HttpStatus.ACCEPTED)
  async handleWebhook(@Body() body: WebhookEventDto) {
    return this.webhooksService.ingestWebhook(body);
  }

  @Get('events')
  async getEvents() {
    return this.webhooksService.getAllEvents();
  }

  @Post('events/:eventId/retry')
  async retryEvent(@Param('eventId') eventId: string) {
    return this.webhooksService.manualRetry(eventId);
  }

  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
