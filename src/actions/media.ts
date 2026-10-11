'use server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

const mediaPath = /^projects\/([0-9a-f-]{36})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.[a-z0-9]{1,8}$/;

export type MediaDownloadState = { error?: string; url?: string };
export async function prepareMediaDownload(_: MediaDownloadState, form: FormData): Promise<MediaDownloadState> {
  const id = z.string().uuid().safeParse(form.get('assetId'));
  if (!id.success) return { error: 'msg.media.badItem' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'msg.auth.signInAgain' };
    const { data: asset, error } = await supabase.from('assets').select('project_id, storage_path').eq('id', id.data).maybeSingle();
    // Do not distinguish nonexistent records from denied records.
    if (error || !asset) return { error: 'msg.media.unavailable' };
    if (mediaPath.exec(asset.storage_path)?.[1] !== asset.project_id) return { error: 'msg.media.unavailable' };
    // The authenticated Storage client independently enforces membership RLS.
    const { data, error: signingError } = await supabase.storage.from('project-media').createSignedUrl(asset.storage_path, 60, { download: true });
    if (signingError || !data?.signedUrl) return { error: 'msg.media.downloadFailed' };
    return { url: data.signedUrl };
  } catch {
    return { error: 'msg.media.downloadFailed' };
  }
}

export type MediaVersion = { id: string; version_number: number; mime_type: string; size_bytes: number; created_at: string };
// "use server" modules may export only async functions, so the cap stays private.
const mediaVersionsLimit = 20;
// Read-only list through the caller's session: asset_versions RLS limits rows to project participants.
export async function listMediaVersions(assetId: string): Promise<{ versions: MediaVersion[]; hasMore: boolean; error?: string }> {
  const id = z.string().uuid().safeParse(assetId);
  if (!id.success) return { versions: [], hasMore: false, error: 'msg.media.badItem' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { versions: [], hasMore: false, error: 'msg.auth.signInAgain' };
    const { data, error } = await supabase.from('asset_versions').select('id, version_number, mime_type, size_bytes, created_at')
      .eq('asset_id', id.data).order('version_number', { ascending: false }).limit(mediaVersionsLimit + 1);
    if (error || !Array.isArray(data)) return { versions: [], hasMore: false, error: 'msg.media.versionsFailed' };
    return { versions: data.slice(0, mediaVersionsLimit) as MediaVersion[], hasMore: data.length > mediaVersionsLimit };
  } catch {
    return { versions: [], hasMore: false, error: 'msg.media.versionsFailed' };
  }
}

export async function prepareMediaVersionDownload(_: MediaDownloadState, form: FormData): Promise<MediaDownloadState> {
  const id = z.string().uuid().safeParse(form.get('versionId'));
  if (!id.success) return { error: 'msg.media.badVersion' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'msg.auth.signInAgain' };
    const { data: version, error } = await supabase.from('asset_versions').select('asset_id, storage_path').eq('id', id.data).maybeSingle();
    if (error || !version) return { error: 'msg.media.versionUnavailable' };
    const { data: asset, error: assetError } = await supabase.from('assets').select('project_id').eq('id', version.asset_id).maybeSingle();
    if (assetError || !asset || mediaPath.exec(version.storage_path)?.[1] !== asset.project_id) return { error: 'msg.media.versionUnavailable' };
    const { data, error: signingError } = await supabase.storage.from('project-media').createSignedUrl(version.storage_path, 60, { download: true });
    if (signingError || !data?.signedUrl) return { error: 'msg.media.downloadFailed' };
    return { url: data.signedUrl };
  } catch { return { error: 'msg.media.downloadFailed' }; }
}

export type MediaDeleteState = { error?: string; success?: string };
export async function deleteMedia(_: MediaDeleteState, form: FormData): Promise<MediaDeleteState> {
  const id = z.string().uuid().safeParse(form.get('assetId'));
  if (!id.success || form.get('confirmation') !== 'delete') return { error: 'msg.media.confirmDelete' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'msg.auth.signInAgain' };
    const { data: asset, error } = await supabase.from('assets').select('project_id, storage_path').eq('id', id.data).maybeSingle();
    if (error || !asset || mediaPath.exec(asset.storage_path)?.[1] !== asset.project_id) return { error: 'msg.media.unavailable' };
    const { data: member, error: memberError } = await supabase.from('project_members').select('role').eq('project_id', asset.project_id).eq('user_id', user.id).maybeSingle();
    if (memberError || !member || !['owner', 'editor'].includes(member.role)) return { error: 'msg.media.noDeleteAccess' };
    const { data: versions, count, error: versionError } = await supabase.from('asset_versions').select('storage_path', { count: 'exact' }).eq('asset_id', id.data).limit(999);
    if (versionError || count === null || count > 999 || versions?.some(version => mediaPath.exec(version.storage_path)?.[1] !== asset.project_id)) return { error: 'msg.media.checkFilesFailed' };
    const paths = [...new Set([asset.storage_path, ...(versions ?? []).map(version => version.storage_path)])];
    const [otherAssets, otherVersions] = await Promise.all([
      supabase.from('assets').select('id').in('storage_path', paths).neq('id', id.data).limit(1),
      supabase.from('asset_versions').select('id').in('storage_path', paths).neq('asset_id', id.data).limit(1),
    ]);
    if (otherAssets.error || otherVersions.error || !Array.isArray(otherAssets.data) || !Array.isArray(otherVersions.data)) return { error: 'msg.media.checkRefsFailed' };
    if (otherAssets.data.length || otherVersions.data.length) return { error: 'msg.media.fileInUse' };
    // Transactional Outbox pattern: Deleting the asset record in Postgres atomically
    // triggers `private.enqueue_media_deletion()`, which locks and enqueues all asset paths
    // into `private.media_deletion_outbox`. The background media-cleanup worker will safely
    // inspect references and remove the files from Storage SDK asynchronously.
    const { data: deleted, error: deleteError } = await supabase.from('assets').delete().eq('id', id.data).eq('storage_path', asset.storage_path).select('id').maybeSingle();
    if (deleteError || !deleted) return { error: 'msg.media.deleteRecordFailed' };
    revalidatePath('/media');
    return { success: 'msg.media.deleted' };
  } catch { return { error: 'msg.media.deleteUnconfirmed' }; }
}
