import { redirect } from 'next/navigation';
import { getOrganizations } from '@/lib/projects';
import CreateVideoPage from '@/components/create-video-page';

export default async function CreatePage() {
  if (!(await getOrganizations()).length) redirect('/onboarding');
  return <CreateVideoPage />;
}
