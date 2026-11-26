import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';

interface WebhookJob {
  id: string;
  event_id: string;
  type: string;
  payload: any;
  status: string;
  attempts: number;
  max_attempts: number;
}

@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private isRunning = false;
  private readonly workerId = process.env.WORKER_ID || `worker-${Math.random().toString(36).substring(2, 7)}`;
  private pollInterval = 1000; // 1 second
  private leaseDurationSeconds = 15; // 15 seconds lock duration
  private currentJobHeartbeat: NodeJS.Timeout | null = null;

  constructor(private readonly db: DatabaseService) {}

  onApplicationBootstrap() {
    this.logger.log(`Starting worker background process: ${this.workerId}`);
    this.isRunning = true;
    this.pollLoop();
  }

  onApplicationShutdown() {
    this.logger.log(`Shutting down worker process: ${this.workerId}`);
    this.isRunning = false;
    if (this.currentJobHeartbeat) {
      clearInterval(this.currentJobHeartbeat);
    }
  }

  private async pollLoop() {
    while (this.isRunning) {
      try {
        const processed = await this.claimAndProcessNextEvent();
        if (!processed) {
          await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
        }
      } catch (err: any) {
        this.logger.error(`Error in worker poll loop: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
      }
    }
  }

  /**
   * Concurrency & Crash recovery:
   * Uses Postgres 'FOR UPDATE SKIP LOCKED'.
   * Recovers events that:
   * 1. Are 'PENDING' and due for execution (next_run_at <= NOW())
   * 2. Are 'PROCESSING' but whose lock expired (locked_until < NOW()), meaning the prior worker died mid-flight!
   */
  async claimAndProcessNextEvent(): Promise<boolean> {
    const client = await this.db.getClient();
    let job: WebhookJob | null = null;

    try {
      await client.query('BEGIN');

      const claimSql = `
        SELECT id, event_id, type, payload, status, attempts, max_attempts
        FROM events
        WHERE (status = 'PENDING' AND next_run_at <= NOW())
           OR (status = 'PROCESSING' AND locked_until < NOW())
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED;
      `;

      const result = await client.query(claimSql);

      if (result.rows.length === 0) {
        await client.query('COMMIT');
        return false;
      }

      job = result.rows[0];

      // Update state to PROCESSING with lease timeout
      const updateLockSql = `
        UPDATE events
        SET status = 'PROCESSING',
            attempts = attempts + 1,
            locked_by = $1,
            locked_until = NOW() + ($2 || ' seconds')::INTERVAL,
            updated_at = NOW()
        WHERE id = $3
        RETURNING attempts;
      `;
      const updateRes = await client.query(updateLockSql, [
        this.workerId,
        this.leaseDurationSeconds,
        job.id,
      ]);

      const currentAttempt = updateRes.rows[0].attempts;
      await client.query('COMMIT');

      // Now process the event outside of the claim transaction
      await this.processJob(job, currentAttempt);
      return true;
    } catch (err: any) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed during job claim: ${err.message}`);
      return false;
    } finally {
      client.release();
    }
  }

  private async processJob(job: WebhookJob, attemptNumber: number) {
    const startTime = new Date();
    this.logger.log(`[${this.workerId}] Processing event ${job.event_id} (Attempt #${attemptNumber})`);

    // Start lease heartbeat in case business logic is slow (supports slow:N)
    this.startHeartbeat(job.id);

    try {
      // 1. Check idempotency: Did a previous crashed worker already write to processed_orders?
      const alreadyProcessed = await this.isAlreadyProcessed(job.payload?.data?.orderId, job.event_id);

      if (!alreadyProcessed) {
        // 2. Execute simulation rules
        await this.handleSimulation(job.payload?.data?.simulate, attemptNumber);

        // 3. Execute business action: insert into processed_orders
        await this.executeBusinessAction(job.payload?.data?.orderId, job.event_id);
      } else {
        this.logger.warn(`[${this.workerId}] Event ${job.event_id} was already executed in processed_orders. Finalizing event without duplicating work.`);
      }

      // 4. Mark COMPLETED
      await this.db.query(
        `UPDATE events 
         SET status = 'COMPLETED', locked_by = NULL, locked_until = NULL, updated_at = NOW() 
         WHERE id = $1`,
        [job.id],
      );

      // 5. Record attempt history
      await this.recordAttempt(
        job.event_id,
        attemptNumber,
        startTime,
        new Date(),
        'SUCCESS',
        null,
      );

      this.logger.log(`[${this.workerId}] Successfully processed event ${job.event_id}`);
    } catch (error: any) {
      await this.handleProcessingError(job, attemptNumber, startTime, error);
    } finally {
      this.stopHeartbeat();
    }
  }

  private async isAlreadyProcessed(orderId: string, eventId: string): Promise<boolean> {
    if (!orderId) return false;
    const res = await this.db.query(
      `SELECT 1 FROM processed_orders WHERE order_id = $1 OR event_id = $2`,
      [orderId, eventId],
    );
    return res.rowCount > 0;
  }

  /**
   * Requirement 2: Each event that processes successfully must insert exactly one row:
   * processed_orders(order_id, event_id, processed_at)
   */
  private async executeBusinessAction(orderId: string, eventId: string) {
    const idToInsert = orderId || `ORD-${eventId}`;
    const sql = `
      INSERT INTO processed_orders (order_id, event_id, processed_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (order_id) DO NOTHING;
    `;
    await this.db.query(sql, [idToInsert, eventId]);
  }

  /**
   * Simulation Contract:
   * - ok: Processes successfully (default)
   * - fail_then_succeed:N: Fails the first N attempts, then succeeds
   * - always_fail: Fails on every attempt
   * - slow:N: Takes N seconds, then succeeds
   */
  private async handleSimulation(simulateValue: string | undefined, attemptNumber: number) {
    if (!simulateValue || simulateValue === 'ok') {
      return;
    }

    if (simulateValue === 'always_fail') {
      throw new Error(`Simulated permanent failure (always_fail)`);
    }

    if (simulateValue.startsWith('fail_then_succeed:')) {
      const parts = simulateValue.split(':');
      const failCount = parseInt(parts[1], 10) || 1;
      if (attemptNumber <= failCount) {
        throw new Error(`Simulated temporary failure (fail_then_succeed:${failCount}, current attempt: ${attemptNumber})`);
      }
      return; // Succeeds on attempt > N
    }

    if (simulateValue.startsWith('slow:')) {
      const parts = simulateValue.split(':');
      const seconds = parseInt(parts[1], 10) || 5;
      this.logger.log(`[${this.workerId}] Simulating slow processing: sleeping for ${seconds}s...`);
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return;
    }
  }

  /**
   * Retries with exponential backoff and attempt recording
   */
  private async handleProcessingError(job: WebhookJob, attemptNumber: number, startTime: Date, error: Error) {
    const finishTime = new Date();
    const isExhausted = attemptNumber >= job.max_attempts;
    const resultType = isExhausted ? 'PERMANENT_FAILURE' : 'TEMPORARY_FAILURE';

    this.logger.warn(`[${this.workerId}] Attempt ${attemptNumber} for event ${job.event_id} failed: ${error.message}`);

    // Record attempt
    await this.recordAttempt(job.event_id, attemptNumber, startTime, finishTime, resultType, error.message);

    if (isExhausted) {
      await this.db.query(
        `UPDATE events
         SET status = 'FAILED',
             locked_by = NULL,
             locked_until = NULL,
             last_error = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [error.message, job.id],
      );
      this.logger.error(`[${this.workerId}] Event ${job.event_id} permanently failed after ${attemptNumber} attempts.`);
    } else {
      // Exponential backoff: 2^attempt * 2 seconds (e.g., 4s, 8s, 16s...)
      const backoffSeconds = Math.min(Math.pow(2, attemptNumber) * 2, 60);
      await this.db.query(
        `UPDATE events
         SET status = 'PENDING',
             next_run_at = NOW() + ($1 || ' seconds')::INTERVAL,
             locked_by = NULL,
             locked_until = NULL,
             last_error = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [backoffSeconds, error.message, job.id],
      );
      this.logger.log(`[${this.workerId}] Event ${job.event_id} rescheduled in ${backoffSeconds}s`);
    }
  }

  private async recordAttempt(
    eventId: string,
    attemptNumber: number,
    startTime: Date,
    finishTime: Date,
    result: string,
    errorMessage: string | null,
  ) {
    const sql = `
      INSERT INTO event_attempts (event_id, attempt_number, worker_identifier, start_time, finish_time, result, error_message)
      VALUES ($1, $2, $3, $4, $5, $6, $7);
    `;
    await this.db.query(sql, [
      eventId,
      attemptNumber,
      this.workerId,
      startTime,
      finishTime,
      result,
      errorMessage,
    ]);
  }

  private startHeartbeat(jobId: string) {
    this.stopHeartbeat();
    this.currentJobHeartbeat = setInterval(async () => {
      try {
        await this.db.query(
          `UPDATE events SET locked_until = NOW() + ($1 || ' seconds')::INTERVAL WHERE id = $2 AND status = 'PROCESSING'`,
          [this.leaseDurationSeconds, jobId],
        );
      } catch (err: any) {
        this.logger.error(`Heartbeat update failed: ${err.message}`);
      }
    }, (this.leaseDurationSeconds / 2) * 1000);
  }

  private stopHeartbeat() {
    if (this.currentJobHeartbeat) {
      clearInterval(this.currentJobHeartbeat);
      this.currentJobHeartbeat = null;
    }
  }
}
