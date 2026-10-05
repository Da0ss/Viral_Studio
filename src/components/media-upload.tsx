'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { mediaFormats, validateMediaMetadata } from '@/lib/media-file';

export function MediaUpload({ projects }: { projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const element = event.currentTarget;
    const data = new FormData(element);
    const file = fileInput.current?.files?.[0];
    const project = String(data.get('project') ?? '');
    setError(''); setMessage('');
    if (!projects.some(item => item.id === project)) { setError('Выберите проект.'); return; }
    if (!(file instanceof File)) { setError('Выберите файл.'); return; }
    const invalid = validateMediaMetadata(file.size, file.type);
    if (invalid) { setError(invalid); return; }
    busy.current = true; setPending(true);
    const body = new FormData(); body.set('file', file);
    try {
      const response = await fetch(`/api/projects/${project}/media`, { method: 'POST', body });
      if (!response.ok) {
        // Do not display arbitrary proxy/hosting errors or HTML responses.
        setError(response.status === 401 ? 'Войдите снова.' : response.status === 403 ? 'Нет права загружать в этот проект.' : response.status === 413 ? 'Размер запроса превышает лимит сервера.' : 'Не удалось загрузить файл. Проверьте формат и соединение.');
        return;
      }
      const result = await response.json();
      if (response.status !== 201 || typeof result.id !== 'string') throw new Error('Unexpected response');
      element.reset();
      if (fileInput.current) fileInput.current.value = '';
      setMessage('Материал загружен.'); router.refresh();
    } catch { setError('Не удалось подтвердить загрузку. Обновите список перед повторной попыткой, чтобы не создать дубликат.'); }
    finally { busy.current = false; setPending(false); }
  }
  if (!projects.length) return <p>Нет подходящих проектов для загрузки. Уточните поиск или получите роль owner/editor.</p>;
  return <form onSubmit={submit} aria-label="Загрузка материала" aria-busy={pending}>
    <fieldset disabled={pending}><legend>Загрузить материал</legend>
      <label>Проект<select name="project" required defaultValue=""><option value="" disabled>Выберите проект</option>{projects.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>Файл материала<input ref={fileInput} type="file" name="file" required accept={Object.keys(mediaFormats).join(',')} /></label>
      <p>JPG, PNG, WebP, MP4, WebM, MP3, WAV или PDF. До 50 МиБ; лимит сервера может быть ниже.</p>
      <button type="submit" className="ghost-button" disabled={pending}>{pending ? 'Загружаем…' : 'Загрузить материал'}</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </form>;
}
