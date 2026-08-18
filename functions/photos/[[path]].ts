import type { Env } from '../lib/env';
import { photoContentType } from '../lib/fotos';
import type { RequestData } from '../lib/users';

/**
 * Liefert Fotos aus R2 unter denselben Pfaden aus, unter denen sie früher als
 * statische Dateien lagen (/photos/<tipId>/<noteId>.<webp|jpg>) — das Frontend
 * musste dafür nicht angefasst werden. Die Middleware hat den Aufrufer bereits
 * geprüft; Fotos bleiben also wie bisher hinter dem Gate.
 *
 * Die Backup-Kopien im Repo (public/photos/) liegen zwar auch im Deployment,
 * aber diese Function beschattet sie — ausgeliefert wird immer der R2-Stand.
 */

/** Nur <slug>/<slug>.<webp|jpg> — kein trash/, keine Pfadtricks. */
const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*\.(webp|jpg)$/;

export const onRequestGet: PagesFunction<Env, string, RequestData> = async ({ params, env }) => {
  const raw = params.path;
  const key = Array.isArray(raw) ? raw.join('/') : String(raw ?? '');
  if (!KEY_RE.test(key)) return notFound();

  const object = await (env.FOTOS as R2Bucket).get(key);
  if (!object) return notFound();

  return new Response(object.body, {
    headers: {
      'Content-Type': photoContentType(key),
      // Was unter einem Schlüssel liegt, ändert sich nie: Ein ausgetauschtes
      // Foto bekommt über den Vorgangs-Abdruck einen neuen Dateinamen, das
      // alte wandert nach trash/. Der Browser darf also lange cachen;
      // `private`, weil die Bilder hinter dem Gate liegen.
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: object.httpEtag,
    },
  });
};

function notFound(): Response {
  return new Response('Nicht gefunden.\n', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
