import type { Session } from './types';

/**
 * Adresse de l'API : NEXT_PUBLIC_API_URL ; sinon la même origine que le site quand l'API sert les pages
 * (NEXT_PUBLIC_SAME_ORIGIN=1, déploiement) ; sinon le même hôte sur le port 3000 (réseau local de la salle).
 */
export function apiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window === 'undefined') return 'http://localhost:3000';
  if (process.env.NEXT_PUBLIC_SAME_ORIGIN === '1') return window.location.origin;
  return `${window.location.protocol}//${window.location.hostname}:3000`;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const SESSION_KEY = 'kata.session';

export function loadSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null): void {
  try {
    if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* stockage indisponible : la session ne survivra pas au rechargement */
  }
}

export async function api<T>(path: string, init: { method?: string; token?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Serveur injoignable');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const code = data?.code ?? data?.message?.code ?? `HTTP_${res.status}`;
    throw new ApiError(res.status, code, data?.message?.message ?? data?.message ?? 'Erreur');
  }
  return data as T;
}
