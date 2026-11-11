'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ApiError, api, saveSession } from '@/lib/api';
import { homeFor } from '@/lib/session';
import type { Session } from '@/lib/types';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; user: Session['user'] }>('/auth/login', { method: 'POST', body: { email, password } });
      saveSession({ token: res.token, user: res.user });
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : homeFor(res.user.role));
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'BAD_CREDENTIALS'
          ? 'E-mail ou mot de passe incorrect.'
          : err instanceof ApiError && err.code === 'NETWORK'
            ? 'Le serveur ne répond pas. Vérifiez le Wi-Fi de la salle.'
            : 'Connexion impossible. Réessayez.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form onSubmit={submit}>
        <h1>Connexion</h1>
        <label>
          E-mail
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Mot de passe
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
