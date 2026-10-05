import { RouteIntro } from '@/components/route-intro';
import { redirect } from 'next/navigation';
import { getOrganizations } from '@/lib/projects';
import type { Route } from 'next';

export default async function CreatePage() {
  if (!(await getOrganizations()).length) redirect('/onboarding' as Route);
  return <RouteIntro title={<>ИДЕИ<br />ДВИГАЮТ<br />БИЗНЕС</>}><p className="subtitle">Создавайте вирусный контент с AI или заказывайте его у нашей команды.</p><button className="cta"><span>Создать ролик</span><i className="icon ph ph-arrow-right" /></button></RouteIntro>;
}
