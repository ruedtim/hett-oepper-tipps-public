import { buildAppData } from '../lib/appdata';
import type { Env } from '../lib/env';
import type { RequestData } from '../lib/users';

/**
 * Der Lesepfad des Frontends — ersetzt das frühere statische /data.json.
 *
 * Gleiche Form, gleiche Sortierung, aber direkt aus D1: Eine Einreichung ist
 * damit sofort sichtbar, nicht erst nach dem nächsten Pages-Build. Läuft wie
 * alles hinter dem Konten-Gate der Middleware.
 *
 * Für den Gäste-Zugang liefert derselbe Endpunkt eine gekürzte Antwort — ohne
 * Wünsche, Namen und Fotos. Das ist der Grund, warum hier `data.user` steht:
 * Was ein Gast nicht sehen soll, darf gar nicht erst mitgeschickt werden.
 */
export const onRequestGet: PagesFunction<Env, string, RequestData> = async ({ env, data }) => {
  try {
    return Response.json(await buildAppData(env.DB as D1Database, { fuerGast: data.user.isGuest }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Fehler beim Laden der Daten:', error);
    return Response.json(
      { error: 'Die Tipps liessen sich nicht laden. Bitte später nochmal.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
};
