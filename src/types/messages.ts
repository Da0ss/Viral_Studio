import { z } from 'zod';

export const messageInputSchema = z.object({
  projectId: z.string().uuid(),
  body: z.string().trim().min(1, 'Сообщение не может быть пустым.').max(4000, 'Сообщение не должно превышать 4000 символов.'),
});

export type ChatMessage = {
  id: string;
  project_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  optimistic?: boolean;
};
