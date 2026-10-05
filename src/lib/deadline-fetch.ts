import 'server-only';

/** Native timeout signal also applies while a response body is being consumed. */
export function createDeadlineFetch(timeoutMs: number, transport: typeof fetch = globalThis.fetch): typeof fetch {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error('Invalid request timeout');
  }
  return (input, init) => {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (input instanceof Request) signals.push(input.signal);
    if (init?.signal) signals.push(init.signal);
    return transport(input, { ...init, signal: AbortSignal.any(signals) });
  };
}
