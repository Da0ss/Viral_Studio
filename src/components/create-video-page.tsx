'use client';

import { useState } from 'react';

interface ModelOption {
  id: string;
  name: string;
  badge: string;
  cost: string;
}

const MODELS: ModelOption[] = [
  { id: 'LTX-Video (Lightricks)', name: 'LTX-Video (Lightricks)', badge: 'Fast', cost: '~$0.02' },
  { id: 'Wan 2.1 (Alibaba)', name: 'Wan 2.1 (Alibaba)', badge: 'SOTA', cost: '~$0.40' },
  { id: 'HunyuanVideo (Tencent)', name: 'HunyuanVideo (Tencent)', badge: 'Cinematic', cost: '~$0.30' },
  { id: 'Kling Video (Kuaishou)', name: 'Kling Video (Kuaishou)', badge: 'Pro', cost: '~$0.60' },
  { id: 'Seedance 2.0 (ByteDance)', name: 'Seedance 2.0 (ByteDance)', badge: 'Studio + Audio', cost: '~$1.20' },
];

export default function CreateVideoPage() {
  const [selectedModel, setSelectedModel] = useState<string>(MODELS[1].id); // По умолчанию Wan 2.1
  const [prompt, setPrompt] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), model: selectedModel }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Ошибка при генерации видео');
      }

      setVideoUrl(data.videoUrl);
    } catch (err: any) {
      setError(err.message || 'Сбой соединения с сервером');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '32px 20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Заголовок */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 800, margin: 0, color: '#111827' }}>
          Генерация видео
        </h1>
        <p style={{ margin: '8px 0 0', color: '#6b7280', fontSize: '15px' }}>
          Выберите модель нейросети и опишите сцену для синтеза видеоряда.
        </p>
      </div>

      <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Селектор нейросетей */}
        <div>
          <label style={{ display: 'block', marginBottom: '10px', fontSize: '14px', fontWeight: 600, color: '#1f2937' }}>
            Нейросеть генерации:
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {MODELS.map((m) => {
              const active = selectedModel === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedModel(m.id)}
                  style={{
                    backgroundColor: '#111418',
                    color: '#ffffff',
                    border: active ? '2px solid #e11d48' : '1px solid #27272a',
                    borderRadius: '8px',
                    padding: '8px 14px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.15s ease',
                    boxShadow: active ? '0 0 12px rgba(225, 29, 72, 0.35)' : 'none',
                  }}
                >
                  <span>{m.name}</span>
                  <span
                    style={{
                      backgroundColor: '#27272a',
                      color: active ? '#f43f5e' : '#a1a1aa',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    {m.badge}
                  </span>
                  <span
                    style={{
                      color: '#71717a',
                      fontSize: '11px',
                      borderLeft: '1px solid #3f3f46',
                      paddingLeft: '6px',
                    }}
                  >
                    {m.cost}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Промпт */}
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 600, color: '#1f2937' }}>
            Текстовый промпт:
          </label>
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A futuristic heavy combat mech stomping through ruins, volumetric smoke, photorealistic 8k..."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              backgroundColor: '#111418',
              color: '#ffffff',
              border: '1px solid #27272a',
              borderRadius: '8px',
              padding: '14px',
              fontSize: '14px',
              lineHeight: 1.5,
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>

        {/* Кнопка запуска */}
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          style={{
            backgroundColor: loading ? '#6b7280' : '#e11d48',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            padding: '14px',
            fontSize: '15px',
            fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.2s',
            boxShadow: '0 4px 14px rgba(225, 29, 72, 0.3)',
          }}
        >
          {loading ? 'Идет процесс генерации...' : 'Сгенерировать видео'}
        </button>
      </form>

      {/* Ошибка */}
      {error && (
        <div
          style={{
            marginTop: '20px',
            padding: '14px',
            backgroundColor: '#450a0a',
            border: '1px solid #991b1b',
            borderRadius: '8px',
            color: '#fca5a5',
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}

      {/* Плеер */}
      {videoUrl && (
        <div
          style={{
            marginTop: '28px',
            backgroundColor: '#111418',
            border: '1px solid #27272a',
            borderRadius: '12px',
            padding: '16px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '12px',
              fontSize: '13px',
              color: '#a1a1aa',
            }}
          >
            <span>Результат генерации ({selectedModel}):</span>
            <a
              href={videoUrl}
              target="_blank"
              rel="noreferrer"
              download
              style={{ color: '#e11d48', textDecoration: 'none', fontWeight: 600 }}
            >
              Скачать MP4
            </a>
          </div>
          <video
            src={videoUrl}
            controls
            autoPlay
            loop
            playsInline
            style={{
              width: '100%',
              borderRadius: '8px',
              backgroundColor: '#000000',
              aspectRatio: '16 / 9',
              display: 'block',
            }}
          />
        </div>
      )}
    </div>
  );
}