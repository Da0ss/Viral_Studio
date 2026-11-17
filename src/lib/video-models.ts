// Client-safe catalogue shared by the create page and the generate-video route.
// The route validates against this exact list; unknown ids are rejected, never mapped.
// `priced` mirrors the server-side catalog: only priced models can be enqueued. The authoritative
// cost and enabled flag live in private.generation_models.
export const videoModels = [
  { id: 'ltx', name: 'LTX-Video (Lightricks)', badge: 'Fast', cost: '~$0.02', priced: true },
  { id: 'minimax', name: 'MiniMax Video-01', badge: 'Realism', cost: '~$0.02', priced: true },
  { id: 'kling', name: 'Kling Video (Kuaishou)', badge: 'Pro', cost: '~$0.60', priced: false },
  { id: 'seedance', name: 'Seedance 2.0 (ByteDance)', badge: 'Studio + Audio', cost: '~$1.20', priced: false },
] as const;

export type VideoModelId = (typeof videoModels)[number]['id'];
export const videoModelIds = videoModels.map((model) => model.id) as [VideoModelId, ...VideoModelId[]];
export const videoPromptLimits = { min: 10, max: 2000 } as const;
