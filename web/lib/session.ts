'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { loadSession, saveSession } from './api';
import type { Session } from './types';

/** Page d'accueil de chaque rôle après connexion. */
export function homeFor(role: string): string {
  if (role === 'ADMIN') return '/admin';
  if (role === 'TECHNICIAN' || role === 'TATAMI_MANAGER') return '/table';
  if (role === 'JUDGE') return '/judge';
  return '/display';
}

/** Session obligatoire avec l'un de ces rôles (ADMIN passe partout), sinon retour à la connexion. */
export function useRequiredSession(roles: string[], path: string): { session: Session | null; logout: () => void } {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s || (s.user.role !== 'ADMIN' && !roles.includes(s.user.role))) router.replace(`/login?next=${encodeURIComponent(path)}`);
    else setSession(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, path]);

  const logout = () => {
    saveSession(null);
    router.replace(`/login?next=${encodeURIComponent(path)}`);
  };
  return { session, logout };
}

/** Message lisible pour les codes d'erreur de l'API. */
const ERRORS: Record<string, string> = {
  NETWORK: 'Le serveur ne répond pas.',
  UNAUTHENTICATED: 'Session expirée : reconnectez-vous.',
  FORBIDDEN_ROLE: "Votre rôle ne permet pas cette action.",
  ALREADY_DRAWN: 'Le tirage de cette catégorie a déjà été fait.',
  PLAYER_COUNT_UNSUPPORTED: "Nombre d'inscrits non pris en charge par ce format.",
  PANEL_LOCKED: 'Le panel ne peut plus changer à ce stade.',
  PANEL_INCOMPLETE: 'Tirez le panel de juges avant de commencer.',
  NOT_ENOUGH_JUDGES: 'Pas assez de juges disponibles sans conflit de fédération.',
  AKA_KATA_MISSING: "Le kata de l'AKA n'est pas annoncé.",
  AO_KATA_MISSING: "Le kata de l'AO n'est pas annoncé.",
  ENTRIES_MISSING: 'Les deux participants ne sont pas encore connus.',
  DECLARATION_CLOSED: 'Les katas ne peuvent plus être modifiés.',
  KATA_NOT_IN_LIST: "Ce kata n'est pas dans la liste officielle.",
  MUST_BE_DIFFERENT: 'Ce kata a déjà été présenté : un kata différent est exigé à ce tour (5.2).',
  NO_CONSECUTIVE_REPEAT: 'Un kata ne peut pas être répété au tour suivant (5.2).',
  MAX_2_PER_COMPETITION: 'Ce kata a déjà été présenté deux fois dans la compétition.',
  NOT_REVEALED: 'Le résultat n’est pas encore révélé.',
  NOT_SCORING: "La notation n'est pas ouverte.",
  KIKEN_NOT_ALLOWED: 'Kiken impossible à ce stade.',
  USE_CONFIRM: 'Confirmez le résultat.',
  REPECHAGE_NOT_READY: 'Les deux finales de poule doivent être confirmées.',
  REPECHAGE_EXISTS: 'Le repêchage a déjà été créé.',
  NOT_ELIMINATION_FORMAT: "Cette catégorie n'est pas en élimination avec repêchage.",
  POOLS_INCOMPLETE: 'Tous les combats de poule doivent être confirmés.',
  TIES_UNRESOLVED: 'Égalité à départager par un kata supplémentaire.',
  CUTOFF_TIE: 'Égalité à la limite de qualification.',
  KNOCKOUT_EXISTS: 'Le tableau final existe déjà.',
  EMAIL_TAKEN: 'Cet e-mail est déjà utilisé.',
  NOT_DEMO: 'Réservé aux compétitions de démonstration.',
};

export function errorText(e: unknown): string {
  const err = e as { code?: string; message?: string };
  return (err.code && ERRORS[err.code]) || err.message || 'Erreur inattendue';
}
