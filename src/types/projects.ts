import { z } from 'zod';
export const projectStatuses = ['draft', 'active', 'review', 'completed', 'archived'] as const;
export const projectTypes = ['ai', 'agency'] as const;
export const projectRoles = ['owner', 'editor', 'commenter', 'viewer'] as const;
export const projectInputSchema = z.object({ name: z.string().trim().min(2, 'Введите название проекта.').max(160), description: z.string().trim().max(5000), type: z.enum(projectTypes), status: z.enum(projectStatuses), organizationId: z.string().uuid('Выберите организацию.') });
export type ProjectInput = z.infer<typeof projectInputSchema>; export type ProjectRole = (typeof projectRoles)[number]; export type ProjectStatus = (typeof projectStatuses)[number]; export type ProjectType = (typeof projectTypes)[number];
export interface ProjectListItem { id: string; name: string; description: string; type: ProjectType; status: ProjectStatus; organizationId: string; organizationName: string; updatedAt: string; role: ProjectRole | null; }
export interface OrganizationOption { id: string; name: string; role: 'owner' | 'admin' | 'member'; }
