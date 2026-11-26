import { Module } from '@nestjs/common';
import { DatabaseModule } from './db/database.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [DatabaseModule, WebhooksModule],
})
export class AppModule {}
