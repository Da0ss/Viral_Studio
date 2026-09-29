import type { ProjectSummary } from '@/types/studio';

/** Temporary UI fixtures. Replace with authenticated server-side queries, never browser storage. */
export const projects: ProjectSummary[] = [
  { id: 'natural-care', title: 'Забота в каждом движении', description: 'Рекламный ролик для NaturaCare', productionType: 'AI', updatedAt: '15 сентября 2026', status: 'Готов', image: '/product-campaign.png' },
  { id: 'lumiere', title: 'Больше, чем красота', description: 'Имиджевый ролик для Lumière', productionType: 'Агентство', updatedAt: '14 сентября 2026', status: 'В работе', image: '/assets/images/project-beauty.png' },
];
