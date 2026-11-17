import 'server-only';

import { cancelFalVideo, falConfigured, isFalModelKey, pollFalVideo, submitFalVideo } from '@/lib/fal-video';
import {
  cancelVideo, downloadVideo, pollVideo, submitVideo, VIDEO_MODEL, VIDEO_PROVIDER,
} from '@/lib/huggingface-video';

export type PollResult = { status: 'pending' } | { status: 'completed'; url: string };

export interface VideoProviderAdapter {
  /** Legacy HF jobs are always allowed; Fal needs the multimodel flag and FAL_KEY to submit. */
  submitAvailable(): boolean;
  submit(prompt: string, deadlineAt?: number, jobId?: string): Promise<{ requestPath: string; requestId?: string }>;
  poll(requestPath: string, deadlineAt?: number): Promise<PollResult>;
  cancel(requestPath: string, deadlineAt?: number): Promise<void>;
  download(url: string, deadlineAt?: number): Promise<Uint8Array>;
}

const hfAdapter: VideoProviderAdapter = {
  submitAvailable: () => true,
  submit: async (prompt, deadlineAt) => ({ requestPath: await submitVideo(prompt, deadlineAt) }),
  poll: pollVideo,
  cancel: cancelVideo,
  download: downloadVideo,
};

export const multimodelEnabled = () => process.env.GENERATION_MULTIMODEL_ENABLED === 'true';

/** Returns null for an unknown (provider, model) pair. */
export function adapterFor(provider: string | null | undefined, model: string | null | undefined): VideoProviderAdapter | null {
  if (provider === VIDEO_PROVIDER && model === VIDEO_MODEL) return hfAdapter;
  if (provider === 'fal' && typeof model === 'string' && isFalModelKey(model)) {
    return {
      submitAvailable: () => multimodelEnabled() && falConfigured(),
      submit: (prompt, deadlineAt, jobId) => submitFalVideo(model, prompt, deadlineAt, jobId),
      poll: (path, deadlineAt) => pollFalVideo(model, path, deadlineAt),
      cancel: (path, deadlineAt) => cancelFalVideo(model, path, deadlineAt),
      download: downloadVideo,
    };
  }
  return null;
}
