/**
 * Die Formatierung selbst wohnt in `shared/datum.mjs`, neben der Tagesrechnung —
 * die geteilte Ansicht setzt dieselben Datumsangaben serverseitig. Hier steht
 * nur noch die Weiterleitung, damit kein Aufrufer im Frontend das merken muss.
 */
export { formatDay, formatMonth, formatShort } from '../../shared/datum.mjs';
