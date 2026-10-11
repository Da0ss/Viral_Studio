import { expect, test } from 'vitest';
import { drainScheduledWorkers } from '@/lib/scheduled-worker';

test('drains backlog in round-robin order and respects each queue cap', async () => {
  const order: string[] = [];
  let now = 0;
  const result = await drainScheduledWorkers({
    deadlineAt: 10_000,
    now: () => now,
    maxItemsPerQueue: 2,
    queues: ['a', 'b', 'c'].map(name => ({
      name: name as 'media_cleanup', reserveMs: 1,
      runOne: async () => { order.push(name); now += 1; return 'completed'; },
    })),
  });
  expect(order).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  expect(result).toMatchObject({ started: 6, confirmed: 6, failed: 0 });
});

test('does not start a new item when remaining time is below its reserve', async () => {
  let now = 0;
  let generationStarted = false;
  const result = await drainScheduledWorkers({
    deadlineAt: 100,
    now: () => now,
    queues: [
      { name: 'media_cleanup', reserveMs: 60, runOne: async () => { now = 55; return 'completed'; } },
      { name: 'generation', reserveMs: 75, runOne: async () => { generationStarted = true; return { claimed: 0, advanced: 0 }; } },
    ],
  });
  expect(generationStarted).toBe(false);
  expect(result).toMatchObject({ started: 1, confirmed: 1, deadlineReached: true, queues: { generation: { started: 0, skippedDeadline: 1 } } });
});

test('stops retrying a failed queue and continues other queues', async () => {
  let failedAttempts = 0;
  let healthyAttempts = 0;
  const result = await drainScheduledWorkers({
    deadlineAt: 10_000,
    now: () => 0,
    queues: [
      { name: 'media_cleanup', reserveMs: 1, runOne: async () => { failedAttempts += 1; throw new Error('secret'); } },
      { name: 'media_upload_reconcile', reserveMs: 1, runOne: async () => { healthyAttempts += 1; return 'completed'; } },
    ],
  });
  expect(failedAttempts).toBe(1); expect(healthyAttempts).toBe(4);
  expect(result).toMatchObject({ started: 5, confirmed: 4, failed: 1 });
});

test('treats uncertain and malformed generation acknowledgements as failures', async () => {
  const result = await drainScheduledWorkers({
    deadlineAt: 10_000,
    now: () => 0,
    queues: [{ name: 'generation', reserveMs: 1, runOne: async () => ({ claimed: 2, advanced: 1 }) }],
  });
  expect(result).toMatchObject({ started: 1, confirmed: 0, failed: 1 });
});
