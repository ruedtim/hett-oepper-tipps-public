/**
 * Die Länderliste für das Auswahlfeld im Formular.
 *
 * Name und Flagge zu einem Code wohnen in `shared/laender.mjs` — die geteilte
 * Ansicht beschriftet ihre Tipps serverseitig, und zwei Kopien liefen mit der
 * Zeit auseinander. Die vollständige Liste ist hier geblieben: Sie braucht nur
 * das Formular, und in einer Worker-Antwort hat sie nichts verloren.
 */

import { countryFlag, countryName } from '../../shared/laender.mjs';
import { searchKey } from '../../shared/normalize.mjs';

export { countryFlag, countryName };

/**
 * Die aktuell vergebenen ISO-3166-1-alpha-2-Codes.
 *
 * Diese Liste steht hier ausgeschrieben, statt alle 676 Buchstabenpaare
 * durchzuprobieren und `Intl` entscheiden zu lassen: Intl benennt bereitwillig
 * auch abgeschaffte Codes (DD für die DDR, SU für die Sowjetunion, YU für
 * Jugoslawien) und Sonderfälle wie «Eurozone», «Vereinte Nationen» oder die
 * Test-Platzhalter «Pseudo-Bidi» und «Pseudo-Akzente». Im Auswahlfeld stand
 * Deutschland dadurch zweimal.
 *
 * XK (Kosovo) ist formal nur benutzerdefiniert, aber für eine Reise-App die
 * praktischere Wahl als sein Fehlen.
 */
const ISO_3166_1 =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO ' +
  'FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE ' +
  'JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO ' +
  'MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW ' +
  'PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM ' +
  'TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW';

const CODES = ISO_3166_1.split(' ');

/** Alle Länder, alphabetisch nach deutschem Namen — für das Auswahlfeld im Formular. */
export function allCountries(): { code: string; name: string; flag: string }[] {
  return CODES.map((code) => ({ code, name: countryName(code), flag: countryFlag(code) })).sort(
    (a, b) => a.name.localeCompare(b.name, 'de'),
  );
}

/**
 * Namen, die im Kopf stehen, aber in keinem Verzeichnis: «USA» ist eine
 * Abkürzung, «England» ein Landesteil, «Holland» sind zwei Provinzen. Wer sie
 * eintippt, findet ohne diese Liste nichts — «Vereinigte Staaten» tippt niemand.
 *
 * Sie stehen darum auch in der Vorschlagsliste: Ein Alias, den man nur trifft,
 * wenn man ihn schon kennt, hilft keinem.
 */
export const COUNTRY_ALIASES: { text: string; code: string }[] = [
  { text: 'USA', code: 'US' },
  { text: 'Amerika', code: 'US' },
  { text: 'England', code: 'GB' },
  { text: 'Grossbritannien', code: 'GB' },
  { text: 'Holland', code: 'NL' },
];

/** searchKey → Code. Lazy, weil das 500 Intl-Aufrufe sind — einmal reicht. */
let byKey: Map<string, string> | null = null;

/**
 * Getipptes zu einem ISO-Code, oder `''` wenn nichts passt.
 *
 * Verglichen wird über `searchKey`: «turkei» findet die Türkei, «ITALIEN»
 * Italien. Der Code selbst zählt ebenfalls — wer «IT» weiss, ist mit zwei
 * Anschlägen fertig. Aliase kommen zuletzt in die Tabelle und dürfen keinen
 * echten Landesnamen verdrängen.
 */
export function countryFromText(text: string): string {
  if (!byKey) {
    byKey = new Map();
    for (const code of CODES) {
      byKey.set(searchKey(countryName(code)), code);
      byKey.set(searchKey(code), code);
    }
    for (const alias of COUNTRY_ALIASES) {
      const key = searchKey(alias.text);
      if (!byKey.has(key)) byKey.set(key, alias.code);
    }
  }
  return byKey.get(searchKey(text)) ?? '';
}
