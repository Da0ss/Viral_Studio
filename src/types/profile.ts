import { z } from 'zod';

export const languages = ['ru', 'en', 'kk'] as const;
export const timezones = ['Asia/Qyzylorda', 'Asia/Almaty', 'Europe/Moscow', 'Europe/Berlin'] as const;

const avatarPath = z.string().trim().max(500).refine(
  (value) => value === '' || (!value.startsWith('/') && !/(^|\/)\.\.($|\/)/.test(value)),
  'msg.profile.relativePath',
);

export const profileSchema = z.object({
  name: z.string().trim().min(2, 'msg.profile.nameTooShort').max(80, 'msg.profile.nameTooLong'),
  email: z.string().trim().toLowerCase().email('msg.auth.invalidEmail'),
  role: z.string().trim().min(2, 'msg.profile.roleRequired').max(100, 'msg.profile.roleTooLong'),
  language: z.enum(languages, { error: 'msg.profile.languageRequired' }),
  timezone: z.enum(timezones, { error: 'msg.profile.timezoneRequired' }),
  avatar_path: avatarPath,
  notification_email: z.boolean(),
  notification_browser: z.boolean(),
  notification_marketing: z.boolean(),
});

export type ProfileValues = z.infer<typeof profileSchema>;

export type ProfileActionResult =
  | { status: 'saved'; emailChangePending: boolean }
  | { status: 'error'; message: string; fieldErrors?: Partial<Record<keyof ProfileValues, string[]>> };
