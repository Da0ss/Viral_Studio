export type ScheduledWorkerQueue = {
  name: 'media_cleanup' | 'media_upload_reconcile' | 'generation';
  /** Conservative admission reserve for one claim plus its work. */
  reserveMs: number;
  runOne: (deadlineAt: number) => Promise<unknown>;
};

export type QueueCounts = { started: number; confirmed: number; failed: number; empty: number; skippedDeadline: number };
export type DrainResult = { queues: Record<string, QueueCounts>; started: number; confirmed: number; failed: number; deadlineReached: boolean };

const outcomes = new Set(['completed', 'retry_scheduled']);

function outcomeConfirmed(value: unknown): 'confirmed' | 'empty' | 'failed' {
  if (value === 'empty') return 'empty';
  if (outcomes.has(String(value))) return 'confirmed';
  if (value && typeof value === 'object' && 'claimed' in value && 'advanced' in value) {
    const { claimed, advanced } = value as { claimed: unknown; advanced: unknown };
    if (typeof claimed !== 'number' || typeof advanced !== 'number' ||
      !Number.isSafeInteger(claimed) || !Number.isSafeInteger(advanced) ||
      claimed < 0 || advanced < 0 || advanced !== claimed) return 'failed';
    return claimed === 0 ? 'empty' : 'confirmed';
  }
  return 'failed';
}

/** Round-robin queue drain. Admission closes before the hard function deadline. */
export async function drainScheduledWorkers(input: {
  queues: ScheduledWorkerQueue[];
  deadlineAt: number;
  now?: () => number;
  maxItemsPerQueue?: number;
}): Promise<DrainResult> {
  const now = input.now ?? Date.now;
  const maxItems = input.maxItemsPerQueue ?? 4;
  const counts: Record<string, QueueCounts> = Object.fromEntries(input.queues.map(({ name }) => [name, {
    started: 0, confirmed: 0, failed: 0, empty: 0, skippedDeadline: 0,
  }]));
  const active = new Set(input.queues.map(({ name }) => name));
  let started = 0;
  let confirmed = 0;
  let failed = 0;
  let deadlineReached = false;

  while (active.size > 0) {
    let madeAttempt = false;
    for (const queue of input.queues) {
      if (!active.has(queue.name)) continue;
      if (counts[queue.name].started >= maxItems) { active.delete(queue.name); continue; }
      if (input.deadlineAt - now() < queue.reserveMs) {
        counts[queue.name].skippedDeadline += 1;
        deadlineReached = true;
        active.delete(queue.name);
        continue;
      }
      madeAttempt = true;
      started += 1;
      counts[queue.name].started += 1;
      let outcome: 'confirmed' | 'empty' | 'failed';
      try { outcome = outcomeConfirmed(await queue.runOne(input.deadlineAt)); }
      catch { outcome = 'failed'; }
      if (outcome === 'confirmed') { confirmed += 1; counts[queue.name].confirmed += 1; }
      if (outcome === 'empty') { counts[queue.name].empty += 1; active.delete(queue.name); }
      if (outcome === 'failed') { failed += 1; counts[queue.name].failed += 1; active.delete(queue.name); }
    }
    if (!madeAttempt) break;
  }

  return { queues: counts, started, confirmed, failed, deadlineReached };
}
