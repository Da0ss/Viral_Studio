import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dictionaries, isMessageKey, translateMessage } from '@/lib/i18n/messages';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('i18n dictionaries', () => {
  it('defines every message key returned by actions, routes and schemas', () => {
    const used = new Set(sourceFiles('src').flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/'(msg\.[A-Za-z]+\.[A-Za-z]+)'/g)].map((match) => match[1])));
    expect(used.size).toBeGreaterThan(100);
    expect([...used].filter((key) => !isMessageKey(key))).toEqual([]);
  });

  it('has no Russian text left in the English dictionary', () => {
    expect(Object.entries(dictionaries.en).filter(([, value]) => /[А-Яа-яЁё]/.test(value))).toEqual([]);
  });

  it('has no empty translations', () => {
    for (const locale of ['ru', 'en', 'kk'] as const) expect(Object.entries(dictionaries[locale]).filter(([, value]) => !value.trim())).toEqual([]);
  });

  it('translates message keys per locale and passes unknown text through unchanged', () => {
    expect(translateMessage('en', 'msg.auth.invalidCredentials')).toBe('The email or password is incorrect.');
    expect(translateMessage('kk', 'msg.auth.invalidCredentials')).toBe('Email немесе құпиясөз қате.');
    expect(translateMessage('ru', 'msg.auth.invalidCredentials')).toBe('Email или пароль указаны неверно.');
    expect(translateMessage('en', 'plain text')).toBe('plain text');
  });
});
