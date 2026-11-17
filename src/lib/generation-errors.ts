// Maps database / RPC error text to generic, client-safe message codes. Never echoes raw messages.
export function safeError(message: string) {
  if (message.includes('budget exhausted')) return 'msg.generation.budgetExhausted';
  if (message.includes('Personal daily generation limit')) return 'msg.generation.personalLimit';
  if (message.includes('media quota')) return 'msg.generation.quota';
  if (message.includes('Generation model unavailable')) return 'msg.generation.modelUnavailable';
  if (message.includes('forbidden') || message.includes('42501')) return 'msg.generation.forbidden';
  if (message.includes('Idempotency key conflict')) return 'msg.generation.keyConflict';
  return 'msg.generation.queueFailed';
}
