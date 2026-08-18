import { heuteIso } from '../../../shared/datum.mjs';
import { searchKey, slugify } from '../../../shared/normalize.mjs';
import { zipStrom } from '../../../shared/zip.mjs';
import { json } from '../../lib/admin';
import { noteFileText, tipFileText, wuenscheFileText } from '../../lib/dataFormat';
import { getAllAggregates } from '../../lib/db';
import type { NoteFile, TipFile } from '../../lib/db';
import type { Env } from '../../lib/env';
import { getUserById, nameKeysOf } from '../../lib/users';
import type { RequestData } from '../../lib/users';
import { getAlleWuensche } from '../../lib/wuensche';

/**
 * Die eigenen Daten zum Mitnehmen, als ZIP.
 *
 * Ein ZWEITER Endpunkt neben `/api/export`, kein Umbau: Der gehört dem
 * nächtlichen Backup-Job, weist sich mit einem Bearer-Token aus und liefert den
 * ganzen Bestand byte-deterministisch für den Spiegel. Diesen hier bedient ein
 * Mensch mit seinem Sitzungs-Cookie, und er liefert genau das, was ihm gehört.
 * Die Einweg-Regel bleibt unberührt — es fliesst weiterhin nur heraus.
 *
 * Dieselben Pfade und dieselbe Serialisierung wie im Spiegel: `dataFormat.ts`
 * bekommt einen zweiten AUFRUFER, kein zweites Format. Nebeneffekt, den man
 * gratis mitnimmt: Der eigene Export lässt sich gegen `data/` diffen.
 *
 * «Eigen» wird pro NOTIZ entschieden, über `nameKeys` und `searchKey(note.by)` —
 * dieselbe Körnung wie `planNoteEdits` in `api/submit.ts`. Der Tipp kommt als
 * Kontext mit, denn eine Notiz ohne ihn wäre unlesbar; die Sachdaten eines Tipps
 * (Name, Ort, Adresse, Koordinaten) sind ohnehin niemandes Beitrag. Fremde
 * Notizen bleiben draussen — die sind nicht meine Daten.
 *
 * Nicht dabei ist der Verlauf: Seine Snapshots tragen das ganze Tipp-Aggregat
 * samt fremder Beiträge. Ohne sie wären «meine Handlungen» inhaltsleer, mit
 * ihnen wäre es ein Export fremder Texte. Und nicht dabei ist der
 * Passwort-Hash, aus dem Grund, aus dem er nirgends hingehört.
 */
export const onRequestGet: PagesFunction<Env, string, RequestData> = async ({ env, data }) => {
  const db = env.DB as D1Database;

  // Der Gäste-Zugang gehört niemandem, also gibt es dort auch nichts
  // mitzunehmen. Das Gate lässt ein GET durch, hier endet es.
  if (data.user.isGuest) {
    return json({ error: 'Der Gäste-Zugang hat keine eigenen Daten.' }, 403);
  }

  const zeile = await getUserById(db, data.user.id);
  if (!zeile) return json({ error: 'Dieses Konto gibt es nicht (mehr).' }, 403);

  const meineKeys = new Set(nameKeysOf(zeile));
  const [aggregates, alleWuensche] = await Promise.all([
    getAllAggregates(db),
    getAlleWuensche(db),
  ]);

  const meineTipps: { tip: TipFile; notes: NoteFile[] }[] = [];
  for (const aggregat of aggregates) {
    const notes = aggregat.notes.filter((note) => meineKeys.has(searchKey(note.by)));
    if (notes.length > 0) meineTipps.push({ tip: aggregat.tip, notes });
  }
  const meineWuensche = alleWuensche.filter((wunsch) => meineKeys.has(searchKey(wunsch.von)));

  const fotos = meineTipps.flatMap(({ tip, notes }) =>
    notes
      .filter((note) => note.photo)
      .map((note) => ({ tipId: tip.id, datei: note.photo as string })),
  );

  const heute = heuteIso();
  const kontoName = zeile.name;
  const konto = {
    name: zeile.name,
    frueherHiess: nameKeysOf(zeile).filter((key) => key !== zeile.name_key),
    email: zeile.email ?? null,
    emailBestaetigtAm: zeile.email_verifiziert_am ?? null,
    admin: zeile.is_admin === 1,
    angelegtAm: zeile.created_at,
    passwortGeaendertAm: zeile.password_changed_at ?? null,
    benachrichtigungen: {
      neueWuensche: (zeile.benachrichtigung_wuensche ?? 0) === 1,
      eigeneTipps: (zeile.benachrichtigung_eigene_tipps ?? 0) === 1,
      eigeneWuensche: (zeile.benachrichtigung_eigene_wuensche ?? 0) === 1,
    },
  };

  const fehlendeFotos: string[] = [];

  /**
   * Als Generator und nicht als fertige Liste: Die Fotos gehen einzeln aus R2
   * durch den Strom, statt alle gleichzeitig im Speicher des Workers zu liegen.
   */
  async function* eintraege() {
    yield {
      name: 'LIESMICH.txt',
      bytes: kodiere(liesmich(kontoName, meineTipps.length, meineWuensche.length, heute)),
    };
    yield { name: 'konto.json', bytes: kodiere(`${JSON.stringify(konto, null, 2)}\n`) };

    if (meineWuensche.length > 0) {
      yield { name: 'wuensche.json', bytes: kodiere(wuenscheFileText(meineWuensche)) };
    }

    for (const { tip, notes } of meineTipps) {
      yield { name: `tipps/${tip.id}/tipp.json`, bytes: kodiere(tipFileText(tip)) };
      for (const note of notes) {
        yield { name: `tipps/${tip.id}/notizen/${note.id}.json`, bytes: kodiere(noteFileText(note)) };
      }
    }

    for (const { tipId, datei } of fotos) {
      const objekt = await (env.FOTOS as R2Bucket).get(`${tipId}/${datei}`);
      if (!objekt) {
        // Ein halber Download ist besser als ein 500. Was fehlt, steht im
        // LIESMICH — nur steht das leider schon oben im Archiv, deshalb hier
        // zusätzlich als eigene Datei am Ende.
        fehlendeFotos.push(`${tipId}/${datei}`);
        continue;
      }
      yield { name: `fotos/${tipId}/${datei}`, bytes: new Uint8Array(await objekt.arrayBuffer()) };
    }

    if (fehlendeFotos.length > 0) {
      yield {
        name: 'FEHLENDE-FOTOS.txt',
        bytes: kodiere(
          `Diese Bilder liessen sich beim Export nicht lesen:\n\n${fehlendeFotos.join('\n')}\n`,
        ),
      };
    }
  }

  const dateiname = `meine-tipps-${slugify(zeile.name) || 'konto'}-${heute}.zip`;

  return new Response(zipStrom(eintraege(), { zeit: new Date() }), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${dateiname}"`,
      'Cache-Control': 'no-store',
    },
  });
};

const KODIERER = new TextEncoder();
const kodiere = (text: string) => KODIERER.encode(text);

function liesmich(name: string, tipps: number, wuensche: number, heute: string): string {
  return `Deine Daten aus «Hett öpper Tipps»
Stand: ${heute}, Konto: ${name}

WAS DRIN IST

  konto.json          Dein Konto: Name, frühere Namen, Adresse und die
                      Benachrichtigungs-Einstellungen. Ohne Passwort.
  tipps/<id>/         Die Tipps, zu denen du etwas beigetragen hast
                      (${tipps} Stück): der Tipp selbst als Zusammenhang und
                      darunter deine eigenen Beschreibungen.
  wuensche.json       Deine Wünsche (${wuensche} Stück), samt den Tipps, die
                      ihnen zugeordnet wurden.
  fotos/              Deine Bilder in voller Auflösung.

WAS NICHT DRIN IST

  Die Beschreibungen und Fotos der anderen. Ein Tipp gehört oft mehreren, und
  deren Beiträge sind nicht deine Daten — deshalb steht in tipps/ zwar der Tipp
  vollständig (Name, Ort, Adresse, Koordinaten sind niemandes Beitrag), aber
  unter notizen/ ausschliesslich, was du selbst geschrieben hast.

  Der Verlauf. Er hält zu jeder Änderung ein Vorher und ein Nachher des ganzen
  Tipps fest, also auch die Texte anderer. Ohne sie wäre eine Liste deiner
  Handlungen inhaltsleer, mit ihnen wäre sie ein Export fremder Beiträge.

DAS FORMAT

  Dieselben JSON-Dateien, in denen die Sammlung auch gesichert wird. Sie sind
  bewusst schlicht gehalten und lassen sich mit jedem Texteditor lesen.
`;
}
