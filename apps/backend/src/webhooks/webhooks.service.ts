import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { WebhookEventDto } from './webhook.dto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Ingest webhook event.
   * Requirement 1 & 3:
   * - Persist incoming event before acknowledging it.
   * - Return 202 for both new and duplicate deliveries.
   * - If an eventId is received again with a different payload, keep the first one and ignore the later one.
   */
  async ingestWebhook(dto: WebhookEventDto) {
    const query = `
      INSERT INTO events (event_id, type, payload, status, next_run_at)
      VALUES ($1, $2, $3, 'PENDING', NOW())
      ON CONFLICT (event_id) DO NOTHING
      RETURNING *;
    `;

    const result = await this.db.query(query, [dto.eventId, dto.type, JSON.stringify(dto)]);

    if (result.rowCount === 0) {
      this.logger.log(`Duplicate webhook received: ${dto.eventId} (ignored payload update)`);
    } else {
      this.logger.log(`New webhook ingested: ${dto.eventId} (${dto.type})`);
    }

    return {
      status: 'accepted',
      eventId: dto.eventId,
    };
  }

  async getAllEvents(limit = 100) {
    const query = `
      SELECT 
        e.*,
        po.order_id,
        po.processed_at as order_processed_at,
        json_agg(
          json_build_object(
            'id', ea.id,
            'attemptNumber', ea.attempt_number,
            'workerIdentifier', ea.worker_identifier,
            'startTime', ea.start_time,
            'finishTime', ea.finish_time,
            'result', ea.result,
            'errorMessage', ea.error_message
          ) ORDER BY ea.attempt_number ASC
        ) FILTER (WHERE ea.id IS NOT NULL) as attempts_history
      FROM events e
      LEFT JOIN processed_orders po ON e.event_id = po.event_id
      LEFT JOIN event_attempts ea ON e.event_id = ea.event_id
      GROUP BY e.id, po.order_id, po.processed_at
      ORDER BY e.created_at DESC
      LIMIT $1;
    `;
    const res = await this.db.query(query, [limit]);
    return res.rows;
  }

  /**
   * Stretch Requirement 8: Manual retry
   * A manual retry gives the event a fresh retry budget.
   * Attempt numbers keep increasing; they do not reset.
   */
  async manualRetry(eventId: string) {
    const query = `
      UPDATE events
      SET status = 'PENDING',
          next_run_at = NOW(),
          max_attempts = attempts + 5,
          locked_by = NULL,
          locked_until = NULL,
          updated_at = NOW()
      WHERE event_id = $1 AND status = 'FAILED'
      RETURNING *;
    `;
    const res = await this.db.query(query, [eventId]);
    if (res.rowCount === 0) {
      throw new Error(`Event ${eventId} not found or not in FAILED state`);
    }
    this.logger.log(`Manually rescheduled event ${eventId}`);
    return res.rows[0];
  }
}
