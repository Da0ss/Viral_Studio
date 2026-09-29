import { z } from 'zod';

export const languages = ['ru', 'en', 'kk'] as const;
export const timezones = ['Asia/Qyzylorda', 'Asia/Almaty', 'Europe/Moscow', 'Europe/Berlin'] as const;

const avatarPath = z.string().trim().max(500).refine(
  (value) => value === '' || (!value.startsWith('/') && !/(^|\/)\.\.($|\/)/.test(value)),
  'Укажите относительный путь без ../ и начального /.',
);

export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Введите имя (не менее 2 символов).').max(80, 'Имя не должно быть длиннее 80 символов.'),
  email: z.string().trim().toLowerCase().email('Введите корректный email.'),
  role: z.string().trim().min(2, 'Укажите должность.').max(100, 'Должность не должна быть длиннее 100 символов.'),
  language: z.enum(languages, { error: 'Выберите язык из списка.' }),
  timezone: z.enum(timezones, { error: 'Выберите часовой пояс из списка.' }),
  avatar_path: avatarPath,
  notification_email: z.boolean(),
  notification_browser: z.boolean(),
  notification_marketing: z.boolean(),
});

export type ProfileValues = z.infer<typeof profileSchema>;

export type ProfileActionResult =
  | { status: 'saved'; emailChangePending: boolean }
  | { status: 'error'; message: string; fieldErrors?: Partial<Record<keyof ProfileValues, string[]>> };
