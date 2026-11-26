# Reliable Webhook Processor

A resilient, idempotent webhook ingestion and processing service built with **NestJS**, **Next.js**, and **PostgreSQL**, deployed with **Docker Compose**.

Designed to handle duplicate webhook deliveries, unreliable downstream systems, mid-flight worker crashes, and concurrent distributed workers.

---

## 1. Architecture

### How Events Move Through the System
1. **Ingestion (`POST /webhooks`)**:
   - The API receives an event payload.
   - It performs an atomic `INSERT INTO events ... ON CONFLICT (event_id) DO NOTHING`.
   - If an event arrives with an existing `event_id` and a modified payload, the duplicate is ignored and the original payload is retained.
   - The API acknowledges receipt immediately with HTTP `202 Accepted` before processing begins.
2. **Transactional Task Queue**:
   - Rather than introducing a dual-write vulnerability between a database and an external broker (like Redis or RabbitMQ), the `events` table in PostgreSQL serves as the persistent, transactional queue.
3. **Background Worker Coordination**:
   - Multiple background worker containers run concurrently.
   - Workers claim work using row-level locking:
     ```sql
     SELECT id, event_id, payload, status, attempts
     FROM events
     WHERE (status = 'PENDING' AND next_run_at <= NOW())
        OR (status = 'PROCESSING' AND locked_until < NOW())
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED;
     ```
   - **No two workers will ever claim the same event**, and slow transactions never block other workers.
4. **Business Action (`processed_orders`)**:
   - When processing completes, the worker executes the business action: inserting into `processed_orders(order_id, event_id, processed_at)`.
   - Idempotency guarantees ensure exactly one row exists per order/event.
5. **Heartbeat & Leases**:
   - Workers set a `locked_until = NOW() + 15 seconds`.
   - Long-running jobs (`slow:N`) maintain a background heartbeat extending the lease while active.

---

## 2. Correctness Guarantees

- **Duplicate Ingestion**: Handled by database unique constraints (`ON CONFLICT (event_id) DO NOTHING`). Subsequent duplicate payloads are discarded while returning HTTP 202.
- **Concurrent Workers**: Guaranteed by PostgreSQL `FOR UPDATE SKIP LOCKED`. Workers claim disjunct sets of rows.
- **Worker Crash Recovery**: If a worker crashes mid-event (e.g. `docker kill`), its lease (`locked_until`) will expire. Another worker automatically detects `status = 'PROCESSING' AND locked_until < NOW()`, reclaims the event, and resumes processing.
- **No Duplicate Business Execution**: If a worker crashes *after* inserting into `processed_orders` but *before* marking `events` completed, the recovering worker checks `processed_orders` prior to re-execution, preventing duplicate order records.
- **Retries with Exponential Backoff**: Failures are rescheduled with exponential delay (`2^attempt * 2s`). Once `max_attempts` is exceeded, the event enters `FAILED` state.
- **Manual Retries**: The operations dashboard allows operators to trigger manual retries. This grants a fresh retry budget while preserving historical attempt counts.

---

## 3. Libraries & Design Decisions

| Component | Choice | Reason |
| :--- | :--- | :--- |
| **Language** | TypeScript | Type safety across backend, workers, and frontend. |
| **Backend / Workers**| NestJS | Modular architecture, dependency injection, clean separation of API and worker entrypoints. |
| **Database & Queue** | PostgreSQL + `pg` | Transactional integrity (`SKIP LOCKED`). Eliminates two-phase commits or split-brain states between a database and a standalone queue. |
| **Frontend** | Next.js 14 + Tailwind CSS | Fast, responsive operations dashboard displaying live statuses, attempt logs, and manual retry controls. |

---

## 4. Known Limitations

- **Polling Overhead**: In high-throughput systems with millions of events/sec, database polling using `SKIP LOCKED` adds query load compared to push-based streaming brokers (like Kafka or RabbitMQ). For extreme scale, PostgreSQL `LISTEN/NOTIFY` or an event streaming pipeline would be introduced.
- **Lease Duration vs. False Stealing**: If a worker's thread freezes (e.g. unhandled sync CPU loop or process pause) longer than 15s without sending a heartbeat, another worker could re-claim the event. Our business action unique constraints prevent double inserts, but redundant computation would take place.

---

## 5. One-Command Startup

Start the entire stack (PostgreSQL, NestJS API, 2 Worker containers, Next.js UI) using Docker Compose:

```bash
docker compose up --build
```

- **Frontend Dashboard**: [http://localhost:3001](http://localhost:3001)
- **Backend API**: [http://localhost:3000](http://localhost:3000)

To tear down containers and clear database volumes:
```bash
docker compose down -v
```

---

## 6. Demonstration Scenarios

We have prepared automated scripts to reproduce all required scenarios:

Run the core demonstration test suite:
```bash
./demo.sh
```

This tests:
1. **Duplicate Event**: 3 simultaneous requests with identical `eventId`. Exactly 1 row inserted into `processed_orders`.
2. **Temporary Failure**: `fail_then_succeed:2` verifies automatic backoff retries and eventual success.
3. **Permanent Failure**: `always_fail` demonstrates retries stopping after exhausting attempts and setting state to `FAILED`.
4. **Parallel Processing**: Dispatches concurrent slow tasks and demonstrates multiple workers executing in parallel without collision.
5. **Crash Recovery**: Submits a 25-second job. Test it by killing a worker:
   ```bash
   docker kill webhook-worker-1
   ```
   Observe in the dashboard or logs that `webhook-worker-2` reclaims and completes the job once the lease expires.

### 500-Event Burst Test
```bash
./burst.sh
```
Submits 500 events in rapid succession to demonstrate system responsiveness and queue draining.
