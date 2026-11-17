// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  organizations: vi.fn(), redirect: vi.fn(), push: vi.fn(), createClient: vi.fn(), rows: vi.fn(),
}));
vi.mock('@/lib/projects', () => ({ getOrganizations: mocks.organizations }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/video-models', () => ({
  videoModels: [
    { id: 'ltx', name: 'LTX Test', badge: 'Fast', cost: '~$0.02', priced: true },
    { id: 'minimax', name: 'MiniMax Test', badge: 'Realism', cost: '~$0.02', priced: true },
    { id: 'kling', name: 'Kling Test', badge: 'Pro', cost: '~$0.60', priced: false },
  ],
  videoPromptLimits: { min: 10, max: 2000 },
}));
vi.mock('@/components/locale-provider', async () => {
  const { translate, translateMessage } = await import('@/lib/i18n/messages');
  return { useI18n: () => ({ locale: 'en', t: (key: never, vars?: Record<string, string | number>) => translate('en', key, vars), tm: (message: string) => translateMessage('en', message) }) };
});
import CreatePage from '@/app/create/page';
import CreateVideoPage from '@/components/create-video-page';
import { dictionaries } from '@/lib/i18n/messages';

const projects = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Alpha' }, { id: '22222222-2222-4222-8222-222222222222', name: 'Beta' }];
const prompt = 'A calm sea at sunrise with gulls';

const lastQuery: { current: Record<string, ReturnType<typeof vi.fn>> } = { current: {} };
function queryClient(data: unknown[] | null, error: unknown = null) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  lastQuery.current = query;
  for (const name of ['select', 'eq', 'in', 'order']) query[name] = vi.fn(() => query);
  query.limit = vi.fn(async () => { mocks.rows(); return { data, error }; });
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user' } }, error: null })) },
    from: vi.fn(() => query),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation(() => { throw new Error('Redirect'); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('sends a user without an organization to onboarding before showing generation', async () => {
  mocks.organizations.mockResolvedValue([]);
  await expect(CreatePage()).rejects.toThrow('Redirect');
  expect(mocks.redirect).toHaveBeenCalledWith('/onboarding');
});

it('passes the writable projects of organization members to the create screen', async () => {
  mocks.organizations.mockResolvedValue([{ id: 'organization', name: 'Studio', role: 'owner' }]);
  mocks.createClient.mockResolvedValue(queryClient([{ role: 'owner', projects: projects[0] }, { role: 'editor', projects: [projects[1]] }, { role: 'editor', projects: null }]));
  const page = await CreatePage();
  expect(page.type).toBe(CreateVideoPage);
  expect(page.props.projects).toEqual(projects);
  expect(lastQuery.current.eq).toHaveBeenCalledWith('user_id', 'user');
  expect(lastQuery.current.in).toHaveBeenCalledWith('role', ['owner', 'editor']);
  expect(mocks.redirect).not.toHaveBeenCalled();
});

it('does not mistake a membership lookup failure for an empty membership', async () => {
  mocks.organizations.mockRejectedValue(new Error('Membership unavailable'));
  await expect(CreatePage()).rejects.toThrow('Membership unavailable');
  expect(mocks.redirect).not.toHaveBeenCalled();
});

it('fails loudly when the project list cannot be loaded', async () => {
  mocks.organizations.mockResolvedValue([{ id: 'organization', name: 'Studio', role: 'owner' }]);
  mocks.createClient.mockResolvedValue(queryClient(null, new Error('boom')));
  await expect(CreatePage()).rejects.toThrow('boom');
});

it('shows the no-project message instead of the form when there is no writable project', () => {
  render(createElement(CreateVideoPage, { projects: [] }));
  expect(screen.getByRole('status').textContent).toBe(dictionaries.en['msg.generation.noProject']);
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('offers only priced models', () => {
  render(createElement(CreateVideoPage, { projects }));
  expect(screen.getByText('LTX Test')).toBeTruthy();
  expect(screen.getByText('MiniMax Test')).toBeTruthy();
  expect(screen.queryByText('Kling Test')).toBeNull();
});

function submit(text = prompt) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.submit(screen.getByRole('textbox').closest('form')!);
}

it('enqueues the job and redirects to the generation page on 202', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ jobId: 'job-1', status: 'queued', reused: false }), { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);
  render(createElement(CreateVideoPage, { projects }));
  fireEvent.click(screen.getByText('MiniMax Test'));
  submit();
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/generations/job-1'));
  const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body).toEqual({ prompt, model: 'minimax', projectId: projects[0].id, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
});

it('reuses the requestId when the same request is retried and rotates it when the input changes', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'msg.generation.busy' }), { status: 429 }));
  vi.stubGlobal('fetch', fetchMock);
  render(createElement(CreateVideoPage, { projects }));
  const ids = async () => fetchMock.mock.calls.map(call => JSON.parse((call as unknown as [string, RequestInit])[1].body as string).requestId as string);
  submit();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await screen.findByRole('alert');
  submit();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await screen.findByRole('alert');
  submit(`${prompt}, wide shot`);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  const [first, second, third] = await ids();
  expect(second).toBe(first);
  expect(third).not.toBe(first);
  expect(mocks.push).not.toHaveBeenCalled();
});

it('shows a translated message for server errors and for unknown error text', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'msg.generation.modelUnavailable' }), { status: 400 })));
  render(createElement(CreateVideoPage, { projects }));
  submit();
  expect((await screen.findByRole('alert')).textContent).toBe(dictionaries.en['msg.generation.modelUnavailable']);
  cleanup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'raw upstream text' }), { status: 500 })));
  render(createElement(CreateVideoPage, { projects }));
  submit();
  expect((await screen.findByRole('alert')).textContent).toBe(dictionaries.en['msg.generation.queueFailed']);
});

it('shows the network failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  render(createElement(CreateVideoPage, { projects }));
  submit();
  expect((await screen.findByRole('alert')).textContent).toBe(dictionaries.en['msg.generation.queueNetworkFailed']);
});

it('ignores a second submit while the first request is in flight', async () => {
  let resolve!: (value: Response) => void;
  const fetchMock = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
  vi.stubGlobal('fetch', fetchMock);
  render(createElement(CreateVideoPage, { projects }));
  submit();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  resolve(new Response(JSON.stringify({ jobId: 'job-2' }), { status: 202 }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/generations/job-2'));
});

it('defines the new generation keys in every locale', () => {
  const keys = ['msg.generation.modelUnavailable', 'msg.generation.noProject', 'generation.createTitle', 'generation.createSubtitle', 'generation.model', 'generation.modelPicker', 'generation.noModels', 'generation.videoUnavailable', 'generation.videoLabel', 'generation.promptCount'] as const;
  for (const locale of ['ru', 'en', 'kk'] as const) for (const key of keys) expect(dictionaries[locale][key]?.trim(), `${locale}:${key}`).toBeTruthy();
});
