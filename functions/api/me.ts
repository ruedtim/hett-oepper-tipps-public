import { json } from '../lib/admin';
import type { Env } from '../lib/env';
import type { RequestData } from '../lib/users';

/**
 * Wer bin ich? Die Oberfläche kann das Cookie nicht lesen (HttpOnly) — sie
 * erfährt hier Name, Admin-Flag und ob noch das Startpasswort gilt. Wer nicht
 * angemeldet ist, kommt gar nicht erst bis hierher (401 aus der Middleware).
 *
 * `gast` ist keine Berechtigungsprüfung, sondern eine Auskunft: Verboten wird
 * das Schreiben im Gate. Die Oberfläche braucht das Flag nur, um Knöpfe
 * wegzulassen, die ohnehin 403 ergäben.
 */
export const onRequestGet: PagesFunction<Env, string, RequestData> = async ({ data }) =>
  json({
    name: data.user.name,
    admin: data.user.isAdmin,
    mustChangePassword: data.user.mustChangePassword,
    gast: data.user.isGuest,
    // Der Gast hat nichts davon und soll auch nichts davon angeboten bekommen —
    // die Zeile trägt keine Adresse, und sie gehört keiner Person.
    email: data.user.isGuest ? null : data.user.email,
    emailVerifiziert: !data.user.isGuest && data.user.emailVerifiziert,
    benachrichtigungWuensche: !data.user.isGuest && data.user.benachrichtigungWuensche,
    benachrichtigungEigeneTipps: !data.user.isGuest && data.user.benachrichtigungEigeneTipps,
    benachrichtigungEigeneWuensche: !data.user.isGuest && data.user.benachrichtigungEigeneWuensche,
  });
