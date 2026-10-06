import { expect, test } from '@playwright/test';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('authenticated user', () => {
  test.skip(!email || !password, 'E2E_EMAIL / E2E_PASSWORD не заданы');

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
