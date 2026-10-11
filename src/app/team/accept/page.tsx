import { redirect } from 'next/navigation';
import { AcceptTeamInvitation } from '@/components/team-workspace';
import { createClient } from '@/lib/supabase/server';
import { getServerTranslator } from '@/lib/i18n/server';

export default async function AcceptTeamInvitationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    const { t } = await getServerTranslator();
    return <main className="page migration-page team-page"><p role="alert">{t('msg.team.badInviteLink')}</p><a href="/team">{t('team.backToTeam')}</a></main>;
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const next = `/team/accept?token=${encodeURIComponent(token)}`;
    redirect(`/login?${new URLSearchParams({ next })}`);
  }
  return <main className="page migration-page team-page"><meta name="referrer" content="no-referrer" /><AcceptTeamInvitation token={token} /></main>;
}
