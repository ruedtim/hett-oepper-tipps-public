import type { RequestData } from './users';

/**
 * Wache vor allem unter /api/admin/.
 *
 * Das Konten-Gate hat den Aufrufer schon durchgelassen und die Benutzerzeile
 * frisch aus der Datenbank gelesen — hier geht es nur noch um die zweite
 * Stufe: Freigeben darf nur ein Konto mit Admin-Flag. Weil die Middleware pro
 * Request nachschlägt, wirkt ein entzogenes Flag sofort, ohne dass die
 * Sitzung enden muss.
 */
export function requireAdmin(data: RequestData): Response | null {
  if (!data.user?.isAdmin) return json({ error: 'Dafür braucht es Admin-Rechte.' }, 403);
  return null;
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
