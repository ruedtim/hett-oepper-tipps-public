import { heuteIso } from '../../../../shared/datum.mjs';
import { json, requireAdmin } from '../../../lib/admin';
import type { Env } from '../../../lib/env';
import type { RequestData } from '../../../lib/users';
import { getBitten } from '../../../lib/zugangsbitten';

/**
 * Die offenen Zugangsbitten für die Kontenverwaltung (#71).
 *
 * Nur lesen — gehandelt wird unter `/api/admin/zugang/<id>`. Die Adresse steht
 * hier mit drin: Sie ist der Grund, warum die Liste existiert, und Admins sehen
 * seit #64 auch in der Kontenliste die Adressen (Entscheid des Besitzers).
 *
 * Den Link einer schon verschickten Einladung baut dieser Endpunkt aus dem
 * `origin` des Requests, wie `api/einladungen/index.ts` — so stimmt er lokal,
 * im Preview und in der Produktion. Er steht dabei, damit ein Admin ihn von
 * Hand weitergeben kann, wenn die Mail nicht ankam.
 */
export const onRequestGet: PagesFunction<Env, string, RequestData> = async ({
  env,
  data,
  request,
}) => {
  const verweigert = requireAdmin(data);
  if (verweigert) return verweigert;

  const bitten = await getBitten(env.DB as D1Database, heuteIso());
  const origin = new URL(request.url).origin;

  return json({
    bitten: bitten.map((bitte) => ({
      ...bitte,
      einladung: bitte.einladung
        ? { ...bitte.einladung, url: `${origin}/einladung?token=${bitte.einladung.id}` }
        : null,
    })),
  });
};
