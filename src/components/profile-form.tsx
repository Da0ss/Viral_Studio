'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { updateProfile } from '@/actions/profile';
import { AvatarUpload } from '@/components/avatar-upload';
import { languages, profileSchema, timezones, type ProfileValues } from '@/types/profile';

const languageLabels: Record<(typeof languages)[number], string> = { ru: 'Русский', en: 'English', kk: 'Қазақша' };

interface ProfileFormProps { initialProfile: ProfileValues; initialAvatarUrl: string | null; }

export function ProfileForm({ initialProfile, initialAvatarUrl }: ProfileFormProps) {
  const router = useRouter();
  const [saveState, setSaveState] = useState<'pristine' | 'dirty' | 'saving' | 'saved' | 'error'>('pristine');
  const [savedProfile, setSavedProfile] = useState(initialProfile);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: initialProfile,
    mode: 'onBlur',
    shouldFocusError: true,
  });
  const { register, handleSubmit, reset, setError, setFocus, formState: { errors, isDirty } } = form;
  const state = saveState === 'saving' || saveState === 'saved' || saveState === 'error' ? saveState : isDirty ? 'dirty' : 'pristine';

  const onInvalid = (formErrors: typeof errors) => {
    const field = Object.keys(formErrors)[0] as keyof ProfileValues | undefined;
    if (field) setFocus(field);
    setSaveState('error');
  };
  const onSubmit = async (values: ProfileValues) => {
    setSaveState('saving');
    const result = await updateProfile(values);
    if (result.status === 'error') {
      Object.entries(result.fieldErrors ?? {}).forEach(([field, messages]) => setError(field as keyof ProfileValues, { message: messages?.[0] }));
      const firstField = Object.keys(result.fieldErrors ?? {})[0] as keyof ProfileValues | undefined;
      if (firstField) setFocus(firstField);
      setSaveState('error');
      return;
    }
    reset(values); setSavedProfile(values);
    setSaveState('saved');
    router.refresh();
    window.setTimeout(() => setSaveState('pristine'), 3500);
  };
  const errorMessage = Object.values(errors)[0]?.message;

  return <form className="profile-form" noValidate onSubmit={handleSubmit(onSubmit, onInvalid)}>
    <div className="profile-form__status" aria-live="polite">{state === 'dirty' && 'Есть несохранённые изменения.'}{state === 'saving' && 'Сохраняем профиль…'}{state === 'saved' && 'Сохранено.'}{state === 'error' && errorMessage}</div>
    <AvatarUpload initialUrl={avatarUrl} onUploaded={(avatarPath, signedUrl) => { const values = form.getValues(); const next = { ...values, avatar_path: avatarPath }; setSavedProfile(next); setAvatarUrl(signedUrl); form.setValue('avatar_path', avatarPath, { shouldDirty: true }); }} />
    <div className="profile-grid">
      <Field label="Имя" error={errors.name?.message}><input {...register('name')} autoComplete="name" /></Field>
      <Field label="Email" error={errors.email?.message}><input {...register('email')} type="email" autoComplete="email" /></Field>
      <Field label="Должность" error={errors.role?.message}><input {...register('role')} autoComplete="organization-title" /></Field>
      <input {...register('avatar_path')} type="hidden" />
      <Field label="Язык" error={errors.language?.message}><select {...register('language')}>{languages.map((language) => <option key={language} value={language}>{languageLabels[language]}</option>)}</select></Field>
      <Field label="Часовой пояс" error={errors.timezone?.message}><select {...register('timezone')}>{timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}</select></Field>
    </div>
    <fieldset className="notification-settings"><legend>Уведомления</legend><label><input {...register('notification_email')} type="checkbox" /> Email-уведомления</label><label><input {...register('notification_browser')} type="checkbox" /> Уведомления в браузере</label><label><input {...register('notification_marketing')} type="checkbox" /> Новости и предложения</label></fieldset>
    <div className="profile-actions"><button className="ghost-button" type="button" disabled={!isDirty || state === 'saving'} onClick={() => { reset(savedProfile); setSaveState('pristine'); }}>Отменить</button><button className="cta" type="submit" disabled={!isDirty || state === 'saving'}><span>{state === 'saving' ? 'Сохраняем…' : 'Сохранить'}</span><i className="icon ph ph-check" /></button></div>
    {state === 'saved' && <div className="profile-toast" role="status">Профиль сохранён.</div>}
  </form>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="profile-field"><span>{label}</span>{children}{error && <small role="alert">{error}</small>}</label>; }
