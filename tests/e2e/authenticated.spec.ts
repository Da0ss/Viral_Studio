import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!;
const password = process.env.E2E_PASSWORD!;
const organizationName = process.env.E2E_ORGANIZATION_NAME!;
const fixtureId = process.env.E2E_FIXTURE_ID!;
const nativeSupabaseRequired = process.env.E2E_NATIVE_SUPABASE_REQUIRED === '1';
const requiredNativeFixture = {
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  E2E_SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  E2E_MAIL_URL: process.env.E2E_MAIL_URL,
  E2E_DESKTOP_OWNER_EMAIL: process.env.E2E_DESKTOP_OWNER_EMAIL,
  E2E_DESKTOP_VIEWER_EMAIL: process.env.E2E_DESKTOP_VIEWER_EMAIL,
  E2E_DESKTOP_VIEWER_ID: process.env.E2E_DESKTOP_VIEWER_ID,
  E2E_MOBILE_OWNER_EMAIL: process.env.E2E_MOBILE_OWNER_EMAIL,
  E2E_MOBILE_VIEWER_EMAIL: process.env.E2E_MOBILE_VIEWER_EMAIL,
  E2E_MOBILE_VIEWER_ID: process.env.E2E_MOBILE_VIEWER_ID,
  E2E_PASSWORD: password,
  E2E_ORGANIZATION_NAME: organizationName,
  E2E_FIXTURE_ID: fixtureId,
};
const missingNativeFixture = Object.entries(requiredNativeFixture).filter(([, value]) => !value).map(([name]) => name);
const admin = url && serviceKey ? createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } }) : null;

async function waitForRecoveryLink(email: string, expectedAuthOrigin: string): Promise<string> {
  const mailUrl = process.env.E2E_MAIL_URL;
  if (!mailUrl) throw new Error('Local email testing URL is missing.');
  const parsedMailUrl = new URL(mailUrl);
  if (parsedMailUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(parsedMailUrl.hostname)) {
    throw new Error('Recovery mail must come from the local Supabase email-testing service.');
  }
  const mailbox = email.split('@')[0];
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const listResponse = await fetch(new URL('/api/v1/messages?start=0&limit=50', mailUrl), { signal: AbortSignal.timeout(3_000) });
      if (listResponse.ok) {
        const result: { messages?: Array<{ ID?: string; To?: Array<{ Email?: string }> }> } = await listResponse.json();
        const messages = (result.messages ?? []).filter(message => message.To?.some(recipient => recipient.Email?.toLowerCase() === email.toLowerCase()));
        for (const message of messages) {
          if (!message.ID) continue;
          const detailResponse = await fetch(new URL(`/api/v1/message/${encodeURIComponent(message.ID)}`, mailUrl), { signal: AbortSignal.timeout(3_000) });
          if (!detailResponse.ok) continue;
          const detail: unknown = await detailResponse.json();
          const contents: string[] = [];
          const collect = (value: unknown) => {
            if (typeof value === 'string') contents.push(value);
            else if (Array.isArray(value)) value.forEach(collect);
            else if (value && typeof value === 'object') Object.values(value).forEach(collect);
          };
          collect(detail);
          for (const content of contents) {
            const matches = content.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
            for (const match of matches) {
              const href = match.replaceAll('&amp;', '&').replaceAll('\\/', '/').replace(/[),.;]+$/, '');
              try {
                const link = new URL(href);
                if (link.origin === expectedAuthOrigin && link.pathname === '/auth/v1/verify' && link.searchParams.get('type') === 'recovery') return link.toString();
              } catch { /* Ignore non-URL email content. */ }
            }
          }
        }
      }
    } catch { /* Retry transient local-mail startup and polling failures until the bounded deadline. */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('The local Supabase recovery email did not arrive with a recovery verification link.');
}

test.describe('native local Supabase acceptance', () => {
  test.skip(!nativeSupabaseRequired, 'Run through scripts/test-supabase-e2e.mjs with disposable local Supabase fixtures.');
  test.beforeAll(() => {
    if (missingNativeFixture.length) {
      throw new Error(`Native Supabase acceptance requires fixture variables: ${missingNativeFixture.join(', ')}`);
    }
  });

test('two real Auth users create a project, share media/chat, and receive private inbox notifications', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const fixtureProject = testInfo.project.name === 'mobile-chromium' ? 'mobile' : 'desktop';
  const ownerEmail = process.env[`E2E_${fixtureProject.toUpperCase()}_OWNER_EMAIL`];
  const viewerEmail = process.env[`E2E_${fixtureProject.toUpperCase()}_VIEWER_EMAIL`];
  const viewerId = process.env[`E2E_${fixtureProject.toUpperCase()}_VIEWER_ID`];
  const device = testInfo.project.use as {
    viewport?: { width: number; height: number } | null;
    screen?: { width: number; height: number };
    deviceScaleFactor?: number;
    isMobile?: boolean;
    hasTouch?: boolean;
    userAgent?: string;
    locale?: string;
  };
  const contextOptions = {
    viewport: device.viewport,
    screen: device.screen,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    userAgent: device.userAgent,
    locale: device.locale,
  };
  const ownerContext = await browser.newContext({ acceptDownloads: true, ...contextOptions });
  const viewerContext = await browser.newContext(contextOptions);
  ownerContext.setDefaultTimeout(10_000);
  ownerContext.setDefaultNavigationTimeout(15_000);
  viewerContext.setDefaultTimeout(10_000);
  viewerContext.setDefaultNavigationTimeout(15_000);
  const owner = await ownerContext.newPage();
  const viewer = await viewerContext.newPage();
  const projectName = `Browser project ${fixtureId} ${testInfo.project.name}`;
  const projectDescription = `fixture-${fixtureId}-${testInfo.project.name}`;
  const mediaName = `browser-${fixtureId}-${testInfo.project.name}.png`;
  const messageBody = `Private inbox fixture ${fixtureId} ${testInfo.project.name}`;
  const reconnectMessage = `Realtime reconnect fixture ${fixtureId} ${testInfo.project.name}`;
  const projectOrganizationName = `${organizationName} ${testInfo.project.name}`;

  let bodyFailed = false;
  const mediaResponses: Array<{ endpoint: string; status: number }> = [];
  owner.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (/^\/api\/projects\/[^/]+\/media(?:\/finalize)?$/.test(path)) {
      mediaResponses.push({ endpoint: path.endsWith('/finalize') ? 'finalize' : 'intent', status: response.status() });
    }
  });
  const stage = (name: string) => console.info(`[auth-e2e] ${testInfo.project.name}: ${name}`);
  const logDialogGeometry = async (phase: string) => {
    const geometry = await owner.evaluate(() => {
      const dialog = document.querySelector<HTMLDialogElement>('dialog.project-modal');
      if (!dialog) return { dialog: null };
      const describe = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { tag: element.tagName, name: element.getAttribute('name'),
          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          scrollTop: element.scrollTop, scrollLeft: element.scrollLeft,
          clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
          position: style.position, transform: style.transform };
      };
      const button = dialog.querySelector('button.cta') ?? dialog.querySelector('button');
      const rect = button?.getBoundingClientRect();
      return { viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY,
        visualWidth: visualViewport?.width, visualHeight: visualViewport?.height,
        visualLeft: visualViewport?.offsetLeft, visualTop: visualViewport?.offsetTop, scale: visualViewport?.scale },
        dialog: describe(dialog), controls: Array.from(dialog.querySelectorAll('form, label, input, textarea, select, button')).map(describe),
        hit: rect ? document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).map(element => ({ tag: element.tagName, name: element.getAttribute('name') })) : [] };
    });
    console.info(`[auth-e2e-layout] ${testInfo.project.name} ${phase}: ${JSON.stringify(geometry)}`);
  };
  const expectNavigationLabel = async (name: string) => {
    const mobile = fixtureProject === 'mobile';
    const navigation = owner.locator(mobile ? '#mobile-nav' : '.desktop-nav');
    if (mobile) await owner.locator('.mobile-menu').click();
    await expect(navigation.getByRole('link', { name, exact: true })).toBeVisible();
    if (mobile) {
      await owner.keyboard.press('Escape');
      await expect(owner.locator('.mobile-menu')).toHaveAttribute('aria-expanded', 'false');
    }
  };
  try {
    stage('login, organization, and project creation');
    await owner.goto('/login');
    await owner.getByLabel('Email').fill(ownerEmail);
    await owner.getByLabel('Пароль').fill(password);
    await owner.getByRole('button', { name: 'Войти' }).click();
    await expect(owner).toHaveURL(/\/onboarding$/);
    await owner.getByLabel('Название организации').fill(projectOrganizationName);
    await owner.getByRole('button', { name: 'Создать организацию' }).click();
    await expect(owner).toHaveURL(/\/projects$/);

    await owner.getByRole('button', { name: 'Создать проект' }).click();
    const dialog = owner.getByRole('dialog');
    await dialog.getByLabel('Название').fill(projectName);
    await dialog.getByLabel('Описание').fill(projectDescription);
    await dialog.getByLabel('Тип').selectOption('ai');
    await dialog.getByLabel('Статус').selectOption('active');
    if (fixtureProject === 'mobile') {
      await expect.poll(() => owner.evaluate(() => innerWidth)).toBe(device.viewport?.width);
      await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
    }
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog.getByRole('status')).toContainText('Проект создан.');
    await dialog.getByRole('button', { name: 'Закрыть' }).click();
    await expect(owner.getByRole('heading', { name: projectName })).toBeVisible();

    const { data: organizationRows, error: organizationError } = await admin!.from('organizations').select('id').eq('name', projectOrganizationName);
    expect(organizationError).toBeNull();
    expect(organizationRows).toHaveLength(1);
    const organizationId = organizationRows![0].id;
    const { data: projectRows, error: projectError } = await admin!.from('projects').select('id').eq('organization_id', organizationId).eq('name', projectName);
    expect(projectError).toBeNull();
    expect(projectRows).toHaveLength(1);
    const projectId = projectRows![0].id;
    expect(viewerId).toBeTruthy();
    stage('team invitation and acceptance');
    await owner.goto('/team');
    const inviteForm = owner.locator('.team-invite-form');
    await inviteForm.getByLabel('Почта участника').fill(viewerEmail!);
    await inviteForm.getByLabel('Проект, если доступ нужен только к нему').selectOption(projectId);
    await inviteForm.getByRole('combobox', { name: 'Проект', exact: true }).selectOption('editor');
    await inviteForm.getByRole('button', { name: 'Создать приглашение' }).click();
    const invitationField = inviteForm.getByLabel('Ссылка-приглашение');
    await expect(invitationField).toBeVisible();
    const invitationUrl = new URL(await invitationField.inputValue());
    expect(invitationUrl.pathname).toBe('/team/accept');
    await viewer.goto('/login');
    await viewer.getByLabel('Email').fill(viewerEmail!);
    await viewer.getByLabel('Пароль').fill(password);
    await viewer.getByRole('button', { name: 'Войти' }).click();
    await expect(viewer).toHaveURL(/\/(?:create|projects|onboarding)(?:\?|$)/);
    await viewer.goto(`${invitationUrl.pathname}${invitationUrl.search}`);
    await viewer.getByRole('button', { name: 'Принять приглашение' }).click();
    await expect(viewer.getByRole('status')).toContainText('Вы присоединились к команде.');
    const { data: projectMember, error: projectMemberError } = await admin!.from('project_members').select('role')
      .eq('project_id', projectId).eq('user_id', viewerId).single();
    expect(projectMemberError).toBeNull();
    expect(projectMember.role).toBe('editor');

    await owner.goto('/projects');
    await owner.getByPlaceholder('Поиск по названию и описанию').fill(projectDescription);
    await owner.getByRole('button', { name: 'Применить' }).click();
    await expect(owner.getByRole('heading', { name: projectName })).toBeVisible();
    await owner.getByPlaceholder('Поиск по названию и описанию').fill(`absent-${fixtureId}`);
    await owner.getByRole('button', { name: 'Применить' }).click();
    await expect(owner.getByRole('heading', { name: 'ПРОЕКТОВ ПОКА НЕТ' })).toBeVisible();

    stage('profile and locale changes');
    await owner.goto('/profile');
    await owner.getByLabel('Имя', { exact: true }).fill(`Owner ${fixtureId.slice(0, 8)}`);
    await owner.getByLabel('Должность').fill('Browser acceptance');
    await owner.getByRole('button', { name: 'Сохранить' }).click();
    await expect(owner.getByRole('status').filter({ hasText: 'Профиль сохранён.' })).toBeVisible();
    await owner.reload();
    await expect(owner.getByLabel('Имя', { exact: true })).toHaveValue(`Owner ${fixtureId.slice(0, 8)}`);
    const avatarPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=', 'base64');
    await owner.getByLabel('Файл аватара').setInputFiles({ name: `avatar-${fixtureId}.png`, mimeType: 'image/png', buffer: avatarPng });
    await owner.getByRole('button', { name: 'Загрузить аватар' }).click();
    await expect(owner.getByRole('status').filter({ hasText: 'Аватар сохранён.' })).toBeVisible();
    const profileTab = await ownerContext.newPage();
    await profileTab.goto('/profile');
    await expect(profileTab.getByRole('region', { name: 'Аватар', exact: true }).getByRole('img')).toBeVisible();
    await expect(profileTab.getByLabel('Имя', { exact: true })).toHaveValue(`Owner ${fixtureId.slice(0, 8)}`);
    await profileTab.close();
    await owner.getByLabel('Язык').selectOption('en');
    await owner.getByRole('button', { name: 'Сохранить' }).click();
    await expectNavigationLabel('Projects');
    await owner.reload();
    await expectNavigationLabel('Media library');
    await expect(owner.getByRole('heading', { name: 'PROFILE' })).toBeVisible();
    await owner.getByLabel('Language').selectOption('kk');
    await owner.getByRole('button', { name: 'Save' }).click();
    await expect(owner.locator('.profile-form__status')).toContainText('Profile saved.');
    const { data: kazakhProfile, error: kazakhProfileError } = await admin!.from('profiles').select('language').eq('email', ownerEmail!).single();
    expect(kazakhProfileError).toBeNull();
    expect(kazakhProfile?.language).toBe('kk');
    await expectNavigationLabel('Жобалар');
    await owner.reload();
    await expectNavigationLabel('Медиа кітапхана');
    await owner.getByLabel('Тіл').selectOption('ru');
    await owner.getByRole('button', { name: 'Сақтау' }).click();
    await expectNavigationLabel('Проекты');

    stage('media upload and download');
    await owner.goto('/media');
    await owner.getByRole('combobox', { name: 'Проект', exact: true }).selectOption(projectId);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=', 'base64');
    await owner.getByLabel('Файл материала').setInputFiles({ name: mediaName, mimeType: 'image/png', buffer: png });
    const [mediaOutcome] = await Promise.all([owner.waitForResponse(response => {
      const path = new URL(response.url()).pathname;
      return response.request().method() === 'POST' && (
        path === `/api/projects/${projectId}/media/finalize` ||
        path === `/api/projects/${projectId}/media` && response.status() !== 200
      );
    }), owner.getByRole('button', { name: 'Загрузить материал' }).click()]);
    if (mediaOutcome.status() !== 201) {
      const result = await mediaOutcome.json().catch(() => ({}));
      const errorCode = typeof result.error === 'string' && /^msg\.[A-Za-z0-9.]+$/.test(result.error) ? result.error : 'unknown';
      console.info(`[auth-e2e-media-error] ${testInfo.project.name}: ${errorCode}`);
    }
    expect(mediaOutcome.status()).toBe(201);
    await expect(owner.getByRole('status').filter({ hasText: 'Файл успешно загружен.' })).toBeVisible();
    const mediaCard = owner.locator('article').filter({ has: owner.getByRole('heading', { name: mediaName }) });
    await expect(mediaCard).toBeVisible();
    await mediaCard.getByRole('button', { name: 'Подготовить скачивание' }).click();
    const downloadLink = mediaCard.getByRole('link', { name: 'Скачать файл' });
    await expect(downloadLink).toBeVisible();
    const downloadWait = owner.waitForEvent('download');
    await downloadLink.click();
    const download = await downloadWait;
    expect(download.suggestedFilename()).toBe(mediaName);
    const downloadedPath = await download.path();
    expect(downloadedPath).toBeTruthy();

    stage('project chat and reconnect');
    await owner.goto(`/projects/${projectId}/chat`);
    await expect(owner.getByRole('heading', { name: projectName })).toBeVisible();
    await expect(owner.getByText('Онлайн')).toBeVisible({ timeout: 15_000 });
    await viewer.goto(`/projects/${projectId}/chat`);
    await expect(viewer.getByText('Онлайн')).toBeVisible({ timeout: 15_000 });
    await expect(viewer.getByText('СООБЩЕНИЙ ПОКА НЕТ')).toBeVisible();
    await owner.getByLabel('Новое сообщение').fill(messageBody);
    await owner.getByRole('button', { name: 'Отправить' }).click();
    await expect(owner.getByText(messageBody)).toBeVisible();
    await expect(viewer.getByText(messageBody)).toBeVisible({ timeout: 15_000 });
    await expect(viewer.getByLabel('Новое сообщение')).toBeVisible();
    await viewerContext.setOffline(true);
    await expect(viewer.getByRole('button', { name: 'Переподключить' })).toBeVisible({ timeout: 15_000 });
    await owner.getByLabel('Новое сообщение').fill(reconnectMessage);
    await owner.getByRole('button', { name: 'Отправить' }).click();
    await expect(owner.getByText(reconnectMessage)).toBeVisible();
    await viewerContext.setOffline(false);
    await expect(viewer.getByText('Онлайн')).toBeVisible({ timeout: 15_000 });
    await expect(viewer.getByText(reconnectMessage)).toHaveCount(1, { timeout: 15_000 });
    await expect(viewer.getByText(messageBody)).toHaveCount(1);
    stage('private inbox notifications');
    await viewer.goto('/notifications');
    const inboxCard = viewer.locator('article').filter({ hasText: 'Новое сообщение в проекте' });
    await expect(inboxCard).toHaveCount(2);
    await expect(inboxCard.first()).toContainText('Откройте чат проекта');
    await owner.goto('/notifications');
    await expect(owner.getByText('Уведомлений пока нет.')).toBeVisible();

    await owner.goto('/media');
    const deleteCard = owner.locator('article').filter({ has: owner.getByRole('heading', { name: mediaName }) });
    owner.once('dialog', dialogEvent => dialogEvent.accept());
    await deleteCard.getByRole('button', { name: 'Удалить материал' }).click();
    await expect(deleteCard).toHaveCount(0);
    const { data: deletedRows, error: deletedError } = await admin!.from('assets').select('id').eq('project_id', projectId);
    expect(deletedError).toBeNull();
    expect(deletedRows).toEqual([]);

    stage('media deletion and password recovery');
    await owner.goto('/forgot-password');
    await owner.getByLabel('Email').fill(ownerEmail!);
    await owner.getByRole('button', { name: 'Отправить ссылку' }).click();
    await expect(owner.getByRole('status')).toContainText('Если аккаунт существует');
    const recoveryLink = await waitForRecoveryLink(ownerEmail!, new URL(url!).origin);
    const updatedPassword = `Recovered-${fixtureId.slice(0, 12)}!9`;
    await owner.goto(recoveryLink);
    await expect(owner).toHaveURL(/\/reset-password$/);
    await owner.getByLabel('Новый пароль').fill(updatedPassword);
    await owner.getByRole('button', { name: 'Обновить пароль' }).click();
    await expect(owner.getByRole('status')).toContainText('Пароль обновлён.');
    const passwordProbe = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const signedInWithRecoveryPassword = await passwordProbe.auth.signInWithPassword({ email: ownerEmail!, password: updatedPassword });
    expect(signedInWithRecoveryPassword.error).toBeNull();
    await passwordProbe.auth.signOut();
  } catch (error) {
    bodyFailed = true;
    if (fixtureProject === 'mobile') await logDialogGeometry('after-failure').catch(() => {});
    console.info(`[auth-e2e-media] ${testInfo.project.name}: ${JSON.stringify({ responses: mediaResponses,
      feedback: await owner.locator('.media-upload [role="alert"], .media-upload [role="status"]').allTextContents().catch(() => []) })}`);
    throw error;
  } finally {
    const cleanup = await Promise.allSettled([ownerContext.close(), viewerContext.close()]);
    if (!bodyFailed) {
      const failures = cleanup.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Failed to close authenticated E2E browser contexts.');
    }
  }
});
});
