/** Private media object path: projects/<project-id>/<asset-uuid>/<file>.<ext>. Capture group 1 is the project id. Must stay non-global (stateless). */
export const mediaStoragePath = /^projects\/([0-9a-f-]{36})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.[a-z0-9]{1,8}$/;
export function isMediaStoragePath(path: string): boolean {
  return mediaStoragePath.test(path);
}
