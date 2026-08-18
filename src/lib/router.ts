import { useEffect, useState } from 'react';

/**
 * Winziger Hash-Router.
 *
 * Hash statt echter Pfade, weil ein Fragment nie an den Server geht: Damit
 * braucht es weder SPA-Fallback noch Umschreiberegeln, und ein Link in den
 * Gruppenchat funktioniert einfach.
 *
 * Format: `#/tipp/<id>?k=essen&l=IT`
 */
export interface Route {
  /** Pfad ohne führendes «#», z. B. «/» oder «/tipp/da-enzo-al-29-roma». */
  path: string;
  /** Query-String ohne «?». */
  search: string;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const index = raw.indexOf('?');
  if (index === -1) return { path: raw, search: '' };
  return { path: raw.slice(0, index), search: raw.slice(index + 1) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function navigate(path: string, search = ''): void {
  const target = search ? `#${path}?${search}` : `#${path}`;
  if (window.location.hash === target) return;
  window.location.hash = target;
}

/**
 * Filter ändern, ohne einen History-Eintrag pro Tastendruck zu erzeugen.
 * Sonst müsste man nach dem Tippen eines Suchworts zwanzigmal «zurück» drücken.
 */
export function replaceSearch(path: string, search: string): void {
  const target = search ? `#${path}?${search}` : `#${path}`;
  if (window.location.hash === target) return;
  const url = `${window.location.pathname}${window.location.search}${target}`;
  window.history.replaceState(null, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** «/tipp/da-enzo-al-29-roma» → «da-enzo-al-29-roma» */
export function tipIdFromPath(path: string): string | null {
  const match = /^\/tipp\/([a-z0-9-]+)$/.exec(path);
  return match?.[1] ?? null;
}

export type Screen =
  | { name: 'liste' }
  | { name: 'detail'; tipId: string }
  | { name: 'neu' }
  | { name: 'ergaenzen'; tipId: string }
  | { name: 'korrigieren'; tipId: string }
  | { name: 'weg'; tipId: string }
  | { name: 'admin' }
  | { name: 'kategorien' }
  | { name: 'admin-konten' }
  | { name: 'konto' }
  | { name: 'feedback' }
  | { name: 'infos' }
  /** Liste der Gesuche; ein `?o=<ortKey>` engt sie auf einen Ort ein. */
  | { name: 'wuensche' }
  | { name: 'wunsch-neu' }
  /** Den eigenen Wunsch bearbeiten. Die ID ist ein UUID, kein Slug. */
  | { name: 'wunsch-bearbeiten'; wunschId: string };

export function screenFromPath(path: string): Screen {
  if (path === '/neu') return { name: 'neu' };
  if (path === '/feedback') return { name: 'feedback' };
  if (path === '/infos') return { name: 'infos' };
  // Vor '/wuensche', sonst schluckt der kürzere Pfad das Anlegen nicht — hier
  // ist die Reihenfolge egal, weil beide exakt vergleichen; sie steht so nur
  // der Lesbarkeit wegen.
  if (path === '/wuensche/neu') return { name: 'wunsch-neu' };
  if (path === '/wuensche') return { name: 'wuensche' };
  if (path === '/admin') return { name: 'admin' };
  if (path === '/admin/kategorien') return { name: 'kategorien' };
  if (path === '/admin/konten') return { name: 'admin-konten' };
  if (path === '/konto') return { name: 'konto' };

  // Wunsch-IDs sind UUIDs — deshalb ein eigenes Muster und nicht das der
  // Tipp-Slugs.
  const wunsch = /^\/wuensche\/([0-9a-f-]{36})\/bearbeiten$/.exec(path);
  if (wunsch?.[1]) return { name: 'wunsch-bearbeiten', wunschId: wunsch[1] };

  const detail = /^\/tipp\/([a-z0-9-]+)$/.exec(path);
  if (detail?.[1]) return { name: 'detail', tipId: detail[1] };

  const action = /^\/tipp\/([a-z0-9-]+)\/(ergaenzen|korrigieren|weg)$/.exec(path);
  if (action?.[1] && action[2]) {
    return { name: action[2] as 'ergaenzen' | 'korrigieren' | 'weg', tipId: action[1] };
  }

  return { name: 'liste' };
}
