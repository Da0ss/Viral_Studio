import { expect, test } from '@playwright/test';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const authenticatedCaseRequired = process.env.E2E_AUTH_REQUIRED === '1';
const missingCredentials = [!email && 'E2E_EMAIL', !password && 'E2E_PASSWORD'].filter(Boolean);

test.describe('authenticated user', () => {
  test.skip(!authenticatedCaseRequired && missingCredentials.length > 0, 'E2E_EMAIL / E2E_PASSWORD не заданы');
  test.beforeAll(() => {
    if (authenticatedCaseRequired && missingCredentials.length) {
      throw new Error(`Authenticated E2E was required but credentials are missing: ${missingCredentials.join(', ')}`);
    }
  });

  test('может войти и увидеть проекты', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email!);
    await page.getByLabel('Пароль').fill(password!);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL(/\/(?:create|onboarding)(?:\?|$)/);
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'ПРОЕКТЫ' })).toBeVisible();
  });
});
