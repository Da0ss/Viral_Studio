import 'server-only';

/** Native timeout signal also applies while a response body is being consumed. */
export function createDeadlineFetch(timeoutMs: number, transport: typeof fetch = globalThis.fetch, deadlineAt?: number): typeof fetch {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error('Invalid request timeout');
  }
  if (deadlineAt !== undefined && !Number.isFinite(deadlineAt)) throw new Error('Invalid absolute deadline');
  return (input, init) => {
    const remainingMs = deadlineAt === undefined ? timeoutMs : Math.min(timeoutMs, Math.floor(deadlineAt - Date.now()));
    // Refuse to dispatch another mutation after the invocation's work window.
    if (remainingMs < 1) return Promise.reject(new DOMException('Request deadline reached', 'TimeoutError'));
    const signals = [AbortSignal.timeout(remainingMs)];
    if (input instanceof Request) signals.push(input.signal);
    if (init?.signal) signals.push(init.signal);
    return transport(input, { ...init, signal: AbortSignal.any(signals) });
  };
}
