import { expect, test } from '@playwright/test';

// Integrated from teammate's origin/responsive-e2e (f9ec26a).
const viewports = [
  { name: 'phone-320', width: 320, height: 640 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1280', width: 1280, height: 800 },
];
const pages = ['/login', '/register', '/forgot-password', '/reset-password'];

for (const vp of viewports) {
  for (const path of pages) {
    test(`${path} fits ${vp.name} (${vp.width}px)`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'Explicit viewport sweep runs once.');
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        brokenImages: [...document.images].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.getAttribute('src')),
      }));
      expect(layout.overflow).toBe(false);
      expect(layout.brokenImages).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
