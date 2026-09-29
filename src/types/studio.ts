export type StudioRoute = '/create' | '/projects' | '/team' | '/media' | '/profile';

export type ProjectStatus = 'Готов' | 'В работе' | 'На проверке' | 'На доработке';

export interface ProjectSummary {
  id: string;
  title: string;
  description: string;
  productionType: 'AI' | 'Агентство';
  updatedAt: string;
  status: ProjectStatus;
  image: string;
}
