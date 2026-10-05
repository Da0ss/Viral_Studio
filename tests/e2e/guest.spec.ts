import { expect, test } from '@playwright/test';

for (const [path, heading] of [
  ['/login', 'ВОЙТИ'],
  ['/register', 'РЕГИСТРАЦИЯ'],
  ['/forgot-password', 'ВОССТАНОВИТЬ'],
  ['/reset-password', /НОВЫЙ\s*ПАРОЛЬ/],
] as const) {
  test(`guest page ${path} has no runtime or layout errors`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('[data-nextjs-dialog], .vite-error-overlay')).toHaveCount(0);
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      brokenImages: [...document.images].filter(image => !image.complete || image.naturalWidth === 0).map(image => image.getAttribute('src')),
    }));
    expect(layout.overflow).toBe(false);
    expect(layout.brokenImages).toEqual([]);
    expect(errors).toEqual([]);
    await testInfo.attach('page', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
}

for (const path of ['/create', '/projects', '/profile', '/media', '/team', '/onboarding', '/notifications', '/projects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/chat']) {
  test(`guest cannot access ${path}`, async ({ page }) => {
    await page.goto(path);
    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('next')).toBe(path);
    await expect(page.getByRole('heading', { name: 'ВОЙТИ' })).toBeVisible();
  });
}

test('guest routes show authentication UI and protect private pages', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'ВОЙТИ' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Пароль')).toBeVisible();

  await page.goto('/forgot-password');
  await expect(page.getByRole('heading', { name: 'ВОССТАНОВИТЬ' })).toBeVisible();

  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login\?next=%2Fprofile/);
  expect(errors).toEqual([]);
});
