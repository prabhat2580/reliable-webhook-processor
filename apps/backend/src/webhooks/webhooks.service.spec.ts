import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service';
import { DatabaseService } from '../db/database.service';

describe('WebhooksService - Concurrency & Duplicate Protection', () => {
  let service: WebhooksService;
  let mockDb: { query: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        {
          provide: DatabaseService,
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
  });

  it('Requirement 1 & 3: should accept initial event and ignore subsequent duplicates with different payloads', async () => {
    // 1st request: inserts successfully
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ event_id: 'evt_123' }] });

    const firstRes = await service.ingestWebhook({
      eventId: 'evt_123',
      type: 'order.created',
      data: { orderId: 'ORD-1001', customerId: 'CUS-42' },
    });

    expect(firstRes).toEqual({ status: 'accepted', eventId: 'evt_123' });
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (event_id) DO NOTHING'),
      expect.arrayContaining(['evt_123', 'order.created']),
    );

    // 2nd request with same eventId but different payload: ON CONFLICT returns 0 rows updated
    mockDb.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const secondRes = await service.ingestWebhook({
      eventId: 'evt_123',
      type: 'order.created',
      data: { orderId: 'ORD-DIFFERENT', customerId: 'CUS-999' },
    });

    // Still returns 202 accepted and preserves idempotency
    expect(secondRes).toEqual({ status: 'accepted', eventId: 'evt_123' });
  });

  it('Requirement 8: Manual retry resets event status to PENDING and expands retry budget without resetting attempt count', async () => {
    mockDb.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          event_id: 'evt_fail',
          status: 'PENDING',
          attempts: 5,
          max_attempts: 10,
        },
      ],
    });

    const retryRes = await service.manualRetry('evt_fail');
    expect(retryRes.status).toBe('PENDING');
    expect(retryRes.attempts).toBe(5);
    expect(retryRes.max_attempts).toBe(10);
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('max_attempts = attempts + 5'),
      ['evt_fail'],
    );
  });
});
