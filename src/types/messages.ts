import { z } from 'zod';

export const messageInputSchema = z.object({
  projectId: z.string().uuid(),
  body: z.string().trim().min(1, 'msg.chat.empty').max(4000, 'msg.chat.tooLong'),
});

export type ChatMessage = {
  id: string;
  project_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  optimistic?: boolean;
};
