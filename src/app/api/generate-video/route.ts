import { NextResponse } from 'next/server';

interface ModelConfig {
  endpoint: string;
  preparePayload: (prompt: string) => Record<string, any>;
}

// Реестр моделей: от бюджетных до супер-флагманов
const MODEL_REGISTRY: Record<string, ModelConfig> = {
  // 1. Ультрабыстрый черновик (~$0.02)
  'ltx': {
    endpoint: 'fal-ai/ltx-video',
    preparePayload: (prompt) => ({
      prompt,
      negative_prompt: 'low quality, blurry, deformed, distorted',
    }),
  },
  // 2. Детализированная геометрия (~$0.40)
  'wan': {
    endpoint: 'fal-ai/wan-t2v',
    preparePayload: (prompt) => ({
      prompt,
      resolution: '720p',
      aspect_ratio: '16:9',
    }),
  },
  // 3. Кинематографичный свет от Tencent (~$0.30)
  'hunyuan': {
    endpoint: 'fal-ai/hunyuan-video',
    preparePayload: (prompt) => ({
      prompt,
      resolution: '720p',
      aspect_ratio: '16:9',
    }),
  },
  // 4. Фотореализм людей и органики (~$0.50)
  'minimax': {
    endpoint: 'fal-ai/minimax/video-01',
    preparePayload: (prompt) => ({
      prompt,
    }),
  },
  // 5. Консистентность персонажей и физика (~$0.60)
  'kling': {
    endpoint: 'fal-ai/kling-video/v3/standard/text-to-video',
    preparePayload: (prompt) => ({
      prompt,
      duration: '5',
      aspect_ratio: '16:9',
    }),
  },
  // 6. Тяжелый флагман с нативным звуком (~$1.20)
  'seedance': {
    endpoint: 'bytedance/seedance-2.0/text-to-video',
    preparePayload: (prompt) => ({
      prompt,
      duration: 5,
      resolution: '720p',
      generate_audio: true, // Включение встроенного саундтрека
    }),
  },
};

function resolveModelConfig(modelName: string): ModelConfig {
  const lower = modelName.toLowerCase();
  if (lower.includes('seedance')) return MODEL_REGISTRY['seedance'];
  if (lower.includes('kling')) return MODEL_REGISTRY['kling'];
  if (lower.includes('minimax') || lower.includes('hailuo')) return MODEL_REGISTRY['minimax'];
  if (lower.includes('wan')) return MODEL_REGISTRY['wan'];
  if (lower.includes('hunyuan')) return MODEL_REGISTRY['hunyuan'];
  return MODEL_REGISTRY['ltx'];
}

export async function POST(req: Request) {
  try {
    const { prompt, model = 'LTX-Video' } = await req.json().catch(() => ({}));

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      return NextResponse.json({ error: 'Промпт должен содержать от 3 символов' }, { status: 400 });
    }

    const apiKey = process.env.FAL_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json({
        error: 'Переменная FAL_KEY не найдена в окружении (.env.local / Vercel)'
      }, { status: 500 });
    }

    const config = resolveModelConfig(model);
    console.log(`[Fal.ai Orchestrator] Запуск: ${config.endpoint} | Модель: ${model}`);

    // 1. Постановка в асинхронную очередь
    const submitRes = await fetch(`https://queue.fal.run/${config.endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config.preparePayload(prompt.trim())),
    });

    const submitData = await submitRes.json();
    console.log('[Fal.ai Queue Submit]:', submitData);

    if (!submitRes.ok) {
      const err = submitData?.detail || submitData?.message || JSON.stringify(submitData);
      return NextResponse.json({ error: `Fal.ai отклонил задачу: ${err}` }, { status: 502 });
    }

    const requestId = submitData.request_id;
    const statusUrl = submitData.status_url || `https://queue.fal.run/${config.endpoint}/requests/${requestId}/status`;
    const responseUrl = submitData.response_url || `https://queue.fal.run/${config.endpoint}/requests/${requestId}`;

    // 2. Пуллинг статуса (до 3 минут, тяжелые модели рендерятся дольше)
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 4000));

      const statusRes = await fetch(statusUrl, {
        headers: { Authorization: `Key ${apiKey}` },
      });
      const statusData = await statusRes.json();
      console.log(`[Fal.ai Polling ${i + 1}/45] Статус: ${statusData?.status}`);

      if (statusData?.status === 'COMPLETED') {
        const resultRes = await fetch(responseUrl, {
          headers: { Authorization: `Key ${apiKey}` },
        });
        const resultData = await resultRes.json();

        const videoUrl =
          resultData?.video?.url ||
          resultData?.videos?.[0]?.url ||
          resultData?.payload?.video?.url;

        if (videoUrl) {
          return NextResponse.json({
            videoUrl,
            model,
            prompt: prompt.trim(),
          });
        }
      }

      if (statusData?.status === 'FAILED') {
        return NextResponse.json({
          error: `Ошибка вычислений: ${statusData?.error || 'Сбой кластера Fal.ai'}`
        }, { status: 500 });
      }
    }

    return NextResponse.json({ error: 'Таймаут генерации (превышено 3 минуты)' }, { status: 504 });

  } catch (err: any) {
    console.error('[Server Crash]:', err);
    return NextResponse.json({ error: `Внутренний сбой сервера: ${err.message}` }, { status: 500 });
  }
}