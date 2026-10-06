// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider, useI18n } from '@/components/locale-provider';

function LocalizedControls() {
  const { t } = useI18n();
  return <><nav aria-label={t('nav.main')}><a href="/projects">{t('nav.projects')}</a></nav><label>{t('profile.language')}<button>{t('common.save')}</button></label></>;
}

afterEach(cleanup);

describe('locale provider', () => {
  it.each([
    ['ru', 'Основная навигация', 'Проекты', 'Язык', 'Сохранить'],
    ['en', 'Main navigation', 'Projects', 'Language', 'Save'],
    ['kk', 'Негізгі навигация', 'Жобалар', 'Тіл', 'Сақтау'],
  ] as const)('updates visible navigation and form controls for %s', (locale, navLabel, projects, language, save) => {
    const view = render(<LocaleProvider locale="ru"><LocalizedControls /></LocaleProvider>);
    view.rerender(<LocaleProvider locale={locale}><LocalizedControls /></LocaleProvider>);
    expect(screen.getByRole('navigation', { name: navLabel })).toBeTruthy();
    expect(screen.getByRole('link', { name: projects })).toBeTruthy();
    expect(screen.getByText(language).parentElement?.querySelector('button')?.textContent).toBe(save);
  });
});
