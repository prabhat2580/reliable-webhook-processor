import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module';
import { WorkerService } from './worker.service';

@Module({
  imports: [DatabaseModule],
  providers: [WorkerService],
})
export class WorkerModule {}
