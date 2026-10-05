import { expect, it, vi } from 'vitest';
import { createDeadlineFetch } from '@/lib/deadline-fetch';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

it('preserves request and options while attaching a deadline', async () => {
  const response = new Response('ok');
  const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
  const fetchWithDeadline = createDeadlineFetch(20_000, transport);
  const input = 'https://example.invalid/storage';
  const init = { method: 'DELETE', headers: { 'x-test': 'value' }, body: 'payload' };
  expect(await fetchWithDeadline(input, init)).toBe(response);
  expect(transport).toHaveBeenCalledWith(input, { ...init, signal: expect.any(AbortSignal) });
});
it('actually signals cancellation of a hanging transport', async () => {
  const transport = vi.fn<typeof fetch>((_, init) => new Promise((_, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
  }));
  const pending = createDeadlineFetch(10, transport)('https://example.invalid');
  const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  // Keep the event loop alive; Node's native timeout signal uses an unref timer.
  await Promise.all([assertion, new Promise(resolve => setTimeout(resolve, 25))]);
  expect(transport.mock.calls[0][1]!.signal!.aborted).toBe(true);
});
it.each(['request', 'init'] as const)('preserves the %s caller cancellation signal', async source => {
  const controller = new AbortController();
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'));
  const input = source === 'request' ? new Request('https://example.invalid', { signal: controller.signal }) : 'https://example.invalid';
  await createDeadlineFetch(20_000, transport)(input, source === 'init' ? { signal: controller.signal } : undefined);
  const combined = transport.mock.calls[0][1]!.signal!;
  expect(combined.aborted).toBe(false);
  controller.abort(new Error('caller cancelled'));
  expect(combined.aborted).toBe(true); expect(combined.reason).toBe(controller.signal.reason);
});
it('passes an already-aborted signal to the transport', async () => {
  const controller = new AbortController(); controller.abort();
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'));
  await createDeadlineFetch(1000, transport)('https://example.invalid', { signal: controller.signal });
  expect(transport.mock.calls[0][1]!.signal!.aborted).toBe(true);
});
it('aborts a real local HTTP response that stalls after headers', async () => {
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.write('partial'); // Never ends: timeout must also stop body consumption.
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    const response = await createDeadlineFetch(200)(`http://127.0.0.1:${address.port}`);
    await expect(response.text()).rejects.toMatchObject({ name: 'TimeoutError' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
it.each([0, -1, 60_001, NaN, 1.5])('rejects invalid deadline %s', timeout => {
  expect(() => createDeadlineFetch(timeout)).toThrow('Invalid request timeout');
});
