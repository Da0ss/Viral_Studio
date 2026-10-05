export type MediaSearchParams = { page?: string | string[]; projectPage?: string | string[]; projectQuery?: string | string[] };
export function singleQueryValue(value: string | string[] | undefined) { return typeof value === 'string' ? value : ''; }
export function mediaNavigationUrl(page: number, projectPage: number, query: string) {
  const params = new URLSearchParams({ page: String(page), projectPage: String(projectPage) });
  if (query) params.set('projectQuery', query);
  return `?${params.toString()}`;
}
