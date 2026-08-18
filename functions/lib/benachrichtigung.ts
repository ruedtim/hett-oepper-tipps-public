/**
 * Die zwei Nachrichten, die diese App von sich aus verschickt: «es gibt einen
 * neuen Wunsch» und «jemand hat deinen Tipp ergänzt».
 *
 * Drei Regeln, die für beide gelten:
 *
 * 1. **Nur an bestätigte Adressen.** Eine bloss eingetippte Adresse gehört
 *    vielleicht jemand anderem — Post über die Runde an Fremde wäre schlimmer
 *    als keine Post.
 * 2. **Einzeln adressiert, nie im Sammel-To oder -BCC.** Die Adressen der Runde
 *    gehen einander nichts an, und ein BCC-Feld ist genau der Ort, an dem so
 *    etwas eines Tages doch sichtbar wird.
 * 3. **Nichts darf am Versand hängen.** Beide Funktionen laufen komplett in
 *    try/catch und werden über `context.waitUntil` angestossen: Ein Wunsch ist
 *    angebracht und ein Tipp ergänzt, auch wenn Resend gerade nicht mag. Ohne
 *    Schlüssel entfällt der Versand still.
 *
 * Wer eine dritte Nachricht baut, halte sich an dieselben drei.
 */

import { searchKey } from '../../shared/normalize.mjs';
import { mailKonfiguriert, sendeMail } from './mail';
import { nameKeysOf } from './users';

interface MailEnv {
  DB?: D1Database;
  RESEND_API_KEY?: string;
  MAIL_ABSENDER?: string;
}

/** Empfängerzeile: alles, was für eine Nachricht gebraucht wird. */
interface Empfaenger {
  id: number;
  name: string;
  email: string;
}

/**
 * `Intl.DisplayNames` statt einer Länderliste — dieselbe Plattform-API wie in
 * src/lib/countries.ts. Bewusst nicht geteilt: Es ist keine Projektlogik, die
 * auseinanderlaufen könnte, sondern ein Aufruf an die Runtime, und die
 * Functions sehen `src/` ohnehin nicht (siehe functions/tsconfig.json).
 */
function landName(code: string): string {
  try {
    return new Intl.DisplayNames(['de'], { type: 'region', fallback: 'code' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/**
 * Nur die Felder, die in der Nachricht vorkommen — nicht `WunschFile`: Der
 * Endpunkt hat an dieser Stelle die geprüfte EINGABE in der Hand, und die trägt
 * weder ID noch Erstelldatum. Ein Nachladen der eben geschriebenen Zeile wäre
 * ein D1-Read für nichts.
 */
export interface WunschNachricht {
  von: string;
  land: string;
  ort?: string;
  text?: string;
  bis: string;
}

/**
 * Wonach der Wunsch fragt, in einer Zeile. Nimmt bewusst nur die zwei Felder,
 * damit sowohl die geprüfte Eingabe (`ort?: string`) als auch eine Datenbank-
 * zeile (`ort: string | null`) hineinpassen.
 */
function wunschZiel(wunsch: { ort?: string | null; land: string }): string {
  return wunsch.ort ? `${wunsch.ort} (${landName(wunsch.land)})` : landName(wunsch.land);
}

export async function sendeWunschMails(
  env: MailEnv,
  { origin, wunsch, autorId }: { origin: string; wunsch: WunschNachricht; autorId: number },
): Promise<void> {
  try {
    if (!mailKonfiguriert(env)) return;

    const zeilen = await (env.DB as D1Database)
      .prepare(
        `SELECT id, name, email FROM users
          WHERE benachrichtigung_wuensche = 1 AND email IS NOT NULL
            AND email_verifiziert_am IS NOT NULL AND disabled = 0 AND is_guest = 0
            AND id != ?1`,
      )
      .bind(autorId)
      .all<Empfaenger>();

    const ziel = wunschZiel(wunsch);
    await verschicke(env, zeilen.results, () => ({
      betreff: `Neuer Wunsch: ${ziel}`,
      text:
        `${wunsch.von} sucht Tipps für ${ziel}.\n\n` +
        (wunsch.text ? `«${wunsch.text}»\n\n` : '') +
        `Gefragt bis ${wunsch.bis}. Weisst du was?\n\n` +
        `${origin}/#/wuensche\n\n` +
        'Keine Lust auf solche Nachrichten? Unter «Konto» abschaltbar.\n',
    }));
  } catch (error) {
    console.error('Wunsch-Benachrichtigungen fehlgeschlagen:', error);
  }
}

export async function sendeErgaenzungsMails(
  env: MailEnv,
  {
    origin,
    tipId,
    tipName,
    tipPlace,
    von,
    text,
    vorherigeAutoren,
    einreicherId,
  }: {
    origin: string;
    tipId: string;
    tipName: string;
    tipPlace: string;
    von: string;
    text: string;
    /** Die `by`-Werte aller Beschreibungen, die vorher schon dranstanden. */
    vorherigeAutoren: string[];
    einreicherId: number;
  },
): Promise<void> {
  try {
    if (!mailKonfiguriert(env)) return;

    const zeilen = await (env.DB as D1Database)
      .prepare(
        `SELECT id, name, email, name_key, alte_namen FROM users
          WHERE benachrichtigung_eigene_tipps = 1 AND email IS NOT NULL
            AND email_verifiziert_am IS NOT NULL AND disabled = 0 AND is_guest = 0
            AND id != ?1`,
      )
      .bind(einreicherId)
      .all<Empfaenger & { name_key: string; alte_namen: string | null }>();

    // Schlüssel → Konto, über ALLE Schlüssel: Eine Beschreibung von vor einer
    // Umbenennung trägt den Namen von damals, und genau die Person soll die
    // Nachricht bekommen. Ohne die alten Schlüssel verstummte dieses Feature
    // für jeden, der sich je umbenannt hat.
    const nachKey = new Map<string, Empfaenger>();
    for (const zeile of zeilen.results) {
      for (const key of nameKeysOf(zeile)) nachKey.set(key, zeile);
    }

    // Über die ID entdoppeln: Zwei Beschreibungen derselben Person am selben
    // Tipp — oder zwei unter verschiedenen Schreibweisen — ergeben eine Mail.
    const empfaenger = new Map<number, Empfaenger>();
    for (const autor of vorherigeAutoren) {
      const treffer = nachKey.get(searchKey(autor));
      if (treffer) empfaenger.set(treffer.id, treffer);
    }
    if (empfaenger.size === 0) return;

    const wo = `${tipName} (${tipPlace})`;
    await verschicke(env, [...empfaenger.values()], () => ({
      betreff: `Ergänzt: ${wo}`,
      text:
        `${von} hat etwas zu «${wo}» geschrieben — einem Tipp, an dem auch du beteiligt bist.\n\n` +
        `«${text}»\n\n` +
        `${origin}/#/tipp/${tipId}\n\n` +
        'Keine Lust auf solche Nachrichten? Unter «Konto» abschaltbar.\n',
    }));
  } catch (error) {
    console.error('Ergänzungs-Benachrichtigungen fehlgeschlagen:', error);
  }
}

/**
 * Jemand hat einen Tipp zu einem Wunsch beigesteuert — die Autorin des Wunsches
 * erfährt davon.
 *
 * Nimmt eine LISTE von Wünschen, weil es zwei Wege hierher gibt: einen
 * bestehenden Tipp zuordnen (genau ein Wunsch) und einen neuen Tipp anlegen, der
 * gleich mehreren Wünschen zugeordnet ist. Gehören mehrere davon derselben
 * Person, bekommt sie EINE Nachricht — sonst läge dieselbe Neuigkeit dreimal im
 * Postfach.
 *
 * Wer den Tipp selbst beisteuert, bekommt nichts: Den eigenen Wunsch zu
 * beantworten kommt vor (man findet selbst etwas), ist aber keine Neuigkeit.
 */
export async function sendeWunschAntwortMails(
  env: MailEnv,
  {
    origin,
    tipId,
    tipName,
    tipPlace,
    von,
    einreicherId,
    wuensche,
  }: {
    origin: string;
    tipId: string;
    tipName: string;
    tipPlace: string;
    von: string;
    einreicherId: number;
    /** Die betroffenen Wünsche — `vonKey` entscheidet, wer die Nachricht bekommt. */
    wuensche: { vonKey: string; ort: string | null; land: string }[];
  },
): Promise<void> {
  try {
    if (!mailKonfiguriert(env) || wuensche.length === 0) return;

    const zeilen = await (env.DB as D1Database)
      .prepare(
        `SELECT id, name, email, name_key, alte_namen FROM users
          WHERE benachrichtigung_eigene_wuensche = 1 AND email IS NOT NULL
            AND email_verifiziert_am IS NOT NULL AND disabled = 0 AND is_guest = 0
            AND id != ?1`,
      )
      .bind(einreicherId)
      .all<Empfaenger & { name_key: string; alte_namen: string | null }>();

    // Über ALLE Schlüssel, wie überall: Ein Wunsch, der vor einer Umbenennung
    // angebracht wurde, trägt zwar dank `umbenennungsStmts` den neuen Schlüssel
    // — ein Restore aus dem Spiegel rechnet ihn aber aus `von` neu, und im
    // Zweifel soll die Nachricht trotzdem ankommen.
    const nachKey = new Map<string, Empfaenger>();
    for (const zeile of zeilen.results) {
      for (const key of nameKeysOf(zeile)) nachKey.set(key, zeile);
    }

    // Empfänger → seine betroffenen Wünsche. Eine Person, eine Nachricht.
    const proEmpfaenger = new Map<number, { an: Empfaenger; ziele: string[] }>();
    for (const wunsch of wuensche) {
      const treffer = nachKey.get(wunsch.vonKey);
      if (!treffer) continue;
      const eintrag = proEmpfaenger.get(treffer.id) ?? { an: treffer, ziele: [] };
      const ziel = wunschZiel(wunsch);
      if (!eintrag.ziele.includes(ziel)) eintrag.ziele.push(ziel);
      proEmpfaenger.set(treffer.id, eintrag);
    }
    if (proEmpfaenger.size === 0) return;

    const wo = `${tipName} (${tipPlace})`;
    for (const { an, ziele } of proEmpfaenger.values()) {
      await verschicke(env, [an], () => ({
        betreff: `Tipp für deinen Wunsch: ${ziele.join(', ')}`,
        text:
          `${von} hat «${wo}» zu ${ziele.length > 1 ? 'deinen Wünschen' : 'deinem Wunsch'} ` +
          `${ziele.join(' und ')} gelegt.\n\n` +
          `${origin}/#/tipp/${tipId}\n\n` +
          'Keine Lust auf solche Nachrichten? Unter «Konto» abschaltbar.\n',
      }));
    }
  } catch (error) {
    console.error('Wunsch-Antwort-Benachrichtigungen fehlgeschlagen:', error);
  }
}

/**
 * Nacheinander und jede für sich abgesichert: Eine abgelehnte Adresse darf die
 * übrigen nicht mitreissen. Der Freundeskreis ist klein genug, dass paralleler
 * Versand nichts brächte ausser einem Ratenlimit beim Dienst.
 */
async function verschicke(
  env: MailEnv,
  an: Empfaenger[],
  nachricht: (empfaenger: Empfaenger) => { betreff: string; text: string },
): Promise<void> {
  for (const empfaenger of an) {
    const { betreff, text } = nachricht(empfaenger);
    try {
      await sendeMail(env, {
        an: empfaenger.email,
        betreff,
        text: `Hallo ${empfaenger.name}\n\n${text}`,
      });
    } catch (error) {
      console.error(`Nachricht an Konto ${empfaenger.id} fehlgeschlagen:`, error);
    }
  }
}
