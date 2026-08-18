import type { Env } from '../../lib/env';
import { requireBackupToken } from '../../lib/exportAuth';
import { photoContentType } from '../../lib/fotos';

/** Nur <slug>/<slug>.<webp|jpg> — kein trash/, keine Pfadtricks. */
const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*\.(webp|jpg)$/;

/**
 * Liefert dem Backup-Job die Bytes EINES Fotos (`?key=<tipId>/<datei>`).
 * Gleiches Bearer-Gate wie /api/export; welcher Key existiert, steht im
 * dortigen Manifest.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireBackupToken(request, env);
  if (denied) return denied;

  const key = new URL(request.url).searchParams.get('key') ?? '';
  if (!KEY_RE.test(key)) return notFound();

  const object = await (env.FOTOS as R2Bucket).get(key);
  if (!object) return notFound();

  return new Response(object.body, {
    headers: { 'Content-Type': photoContentType(key), 'Cache-Control': 'no-store' },
  });
};

function notFound(): Response {
  return Response.json(
    { error: 'Dieses Foto gibt es nicht.' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  );
}
