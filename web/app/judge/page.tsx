'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, loadSession, saveSession } from '@/lib/api';
import { useLive } from '@/lib/live';
import { allowedNext, format, isComplete, preview, tenths } from '@/lib/score';
import type { MyBout, Session, Side } from '@/lib/types';
import { Logo } from '../logo';

const STATUS_TEXT: Record<string, string> = {
  CALLED: 'Combat appelé',
  AKA_PERFORMING: 'AKA présente son kata',
  AO_PERFORMING: 'AO présente son kata',
  SCORING: 'À vous de noter',
  REVEALED: 'Résultat',
};

const ERROR_TEXT: Record<string, string> = {
  EQUAL_SCORES: 'Les deux notes sont identiques : modifiez-en une.',
  INVALID_SCORE: 'Note refusée : elle doit être comprise entre 5,0 et 10,0.',
  NOT_SCORING: "Ce combat n'est pas ouvert à la notation.",
  NOT_IN_PANEL: "Vous ne faites pas partie du panel de ce combat.",
};

interface Sent {
  aka: number;
  ao: number;
}

function sentKey(boutId: string) {
  return `kata.sent.${boutId}`;
}

function readSent(boutId: string): Sent | null {
  try {
    const raw = window.localStorage.getItem(sentKey(boutId));
    return raw ? (JSON.parse(raw) as Sent) : null;
  } catch {
    return null;
  }
}

function writeSent(boutId: string, sent: Sent) {
  try {
    window.localStorage.setItem(sentKey(boutId), JSON.stringify(sent));
  } catch {
    /* sans importance : on perd seulement l'affichage de ses notes après un rechargement */
  }
}

const scoreText = (t: number) => (t / 10).toFixed(1); // « 7.6 », format attendu par l'API

export default function JudgePage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [bouts, setBouts] = useState<MyBout[] | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const s = loadSession();
    if (!s || s.user.role !== 'JUDGE') router.replace('/login?next=/judge');
    else setSession(s);
  }, [router]);

  // empêche la mise en veille de la tablette pendant le combat
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const request = async () => {
      try {
        lock = await (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null;
      } catch {
        /* non pris en charge : le mode kiosque de la tablette prend le relais */
      }
    };
    void request();
    const onVisible = () => document.visibilityState === 'visible' && void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, []);

  const token = session?.token;
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setBouts(await api<MyBout[]>('/bouts/mine', { token }));
      setOffline(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        saveSession(null);
        router.replace('/login?next=/judge');
      } else setOffline(true);
    }
  }, [token, router]);

  const { status: link, socket } = useLive(token, refresh);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000); // filet de sécurité si un événement est perdu
    return () => clearInterval(t);
  }, [refresh]);

  if (!session) return null;

  const current = bouts?.find((b) => b.status === 'SCORING') ?? bouts?.[0] ?? null;
  const linkState = offline ? 'offline' : link;

  return (
    <div className="judge">
      <header className="bar">
        <Logo size={28} />
        <div className="ctx">
          {current ? (
            <>
              <b>{current.category}</b> · {current.stage.label}
              {current.group ? ` · ${current.group}` : ''} · combat {current.position}
            </>
          ) : (
            'Notation kata'
          )}
        </div>
        <span className="link" role="status">
          <i className="dot" data-state={linkState} aria-hidden />
          {linkState === 'online' ? 'Connecté' : linkState === 'offline' ? 'Hors ligne' : 'Connexion…'}
        </span>
        <button
          className="linkbtn"
          onClick={() => {
            saveSession(null);
            router.replace('/login?next=/judge');
          }}
        >
          Se déconnecter
        </button>
      </header>

      {bouts === null ? (
        <div className="waiting">
          <p>Chargement…</p>
        </div>
      ) : current === null ? (
        <div className="waiting">
          <h1>Aucun combat à noter</h1>
          <p>Cet écran se mettra à jour dès que vous serez tiré au sort pour un combat.</p>
        </div>
      ) : (
        <Scoring key={current.id} bout={current} token={session.token} officialId={session.user.officialId} socket={socket} onChanged={refresh} />
      )}
    </div>
  );
}

function Scoring({
  bout,
  token,
  officialId,
  socket,
  onChanged,
}: {
  bout: MyBout;
  token: string;
  officialId: string | null;
  socket: ReturnType<typeof useLive>['socket'];
  onChanged: () => void;
}) {
  const [focus, setFocus] = useState<Side>('AKA');
  const [digits, setDigits] = useState<Record<Side, string>>({ AKA: '', AO: '' });
  const [dq, setDq] = useState<Record<Side, boolean>>({ AKA: false, AO: false });
  const [confirmDq, setConfirmDq] = useState(false);
  const [sent, setSent] = useState<Sent | null>(() => (bout.mine.submitted ? readSent(bout.id) : null));
  const [pending, setPending] = useState<Sent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const pendingRef = useRef<Sent | null>(null);

  const scoring = bout.status === 'SCORING';
  const submitted = bout.mine.submitted && sent !== null;
  const value = (s: Side): number | null => (dq[s] ? 0 : tenths(digits[s]));
  const aka = value('AKA');
  const ao = value('AO');
  const bothDq = aka === 0 && ao === 0;
  const equal = aka !== null && ao !== null && aka === ao && !bothDq;
  const canSend = scoring && !submitted && !sending && aka !== null && ao !== null && !equal;

  function press(d: string) {
    const side = focus;
    if (!allowedNext(digits[side]).includes(d)) return;
    const next = digits[side] + d;
    setDigits({ ...digits, [side]: next });
    setError(null);
    if (isComplete(next)) setFocus(side === 'AKA' ? 'AO' : 'AKA'); // passe à l'autre côté
  }

  function erase() {
    if (dq[focus]) setDq({ ...dq, [focus]: false });
    else setDigits({ ...digits, [focus]: digits[focus].slice(0, -1) });
    setError(null);
  }

  function toggleDq() {
    setDq({ ...dq, [focus]: !dq[focus] });
    setDigits({ ...digits, [focus]: '' });
    setConfirmDq(false);
    setError(null);
  }

  const transmit = useCallback(
    async (payload: Sent): Promise<'ok' | 'retry' | string> => {
      const body = { aka: scoreText(payload.aka), ao: scoreText(payload.ao) };
      try {
        if (socket?.connected) {
          const ack = (await socket.timeout(4000).emitWithAck('score:submit', { boutId: bout.id, ...body })) as { ok: boolean; code?: string; message?: string };
          return ack.ok ? 'ok' : (ack.code ?? 'ERROR');
        }
      } catch {
        /* pas d'accusé de réception : on essaie par HTTP */
      }
      try {
        await api(`/bouts/${bout.id}/scores`, { method: 'POST', token, body });
        return 'ok';
      } catch (e) {
        if (e instanceof ApiError && e.status > 0) return e.code;
        return 'retry';
      }
    },
    [bout.id, socket, token],
  );

  async function send() {
    if (!canSend || aka === null || ao === null) return;
    if ((dq.AKA || dq.AO) && !confirmDq) {
      setConfirmDq(true);
      return;
    }
    setConfirmDq(false);
    await deliver({ aka, ao });
  }

  const deliver = useCallback(
    async (payload: Sent) => {
      setSending(true);
      setError(null);
      const res = await transmit(payload);
      setSending(false);
      if (res === 'ok') {
        writeSent(bout.id, payload);
        setSent(payload);
        setPending(null);
        pendingRef.current = null;
        onChanged();
      } else if (res === 'retry') {
        setPending(payload); // le Wi-Fi a coupé : on réessaie en boucle
        pendingRef.current = payload;
      } else {
        setPending(null);
        pendingRef.current = null;
        setError(ERROR_TEXT[res] ?? 'Notes refusées par le serveur.');
      }
    },
    [bout.id, onChanged, transmit],
  );

  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      if (pendingRef.current) void deliver(pendingRef.current);
    }, 3000);
    return () => clearInterval(t);
  }, [pending, deliver]);

  function edit() {
    if (!sent) return;
    const toDigits = (t: number) => (t === 0 ? '' : String(t));
    setDigits({ AKA: toDigits(sent.aka), AO: toDigits(sent.ao) });
    setDq({ AKA: sent.aka === 0, AO: sent.ao === 0 });
    setSent(null);
  }

  const shown = (s: Side): { text: string; empty: boolean; dq: boolean } => {
    const t = submitted ? (s === 'AKA' ? sent!.aka : sent!.ao) : (pending ? (s === 'AKA' ? pending.aka : pending.ao) : value(s));
    if (t === 0) return { text: 'DQ', empty: false, dq: true };
    if (t !== null) return { text: format(t), empty: false, dq: false };
    return { text: preview(digits[s]), empty: digits[s] === '', dq: false };
  };

  const result = bout.result;
  const myVote = result?.judges.find((j) => j.officialId === officialId)?.vote ?? null;
  const keysOpen = scoring && !submitted && !sending;
  const next = allowedNext(digits[focus]);

  return (
    <div className="arena">
      {(['AKA', 'AO'] as Side[]).map((s) => {
        const c = s === 'AKA' ? bout.aka : bout.ao;
        const r = shown(s);
        return (
          <button
            key={s}
            className="side"
            data-side={s}
            aria-pressed={keysOpen && focus === s}
            disabled={!keysOpen}
            onClick={() => setFocus(s)}
            aria-label={`Note ${s}`}
          >
            <span className="tag">{s}</span>
            <span className="readout" data-empty={r.empty} data-dq={r.dq}>
              {r.text}
            </span>
            <span>
              <span className="who">{c.name ?? 'À venir'}</span>
              <br />
              <span className="kata">
                {c.country ? `${c.country} · ` : ''}
                {c.kata ? `Kata ${c.kata}${c.kataName ? ` ${c.kataName}` : ''}` : 'Kata non déclaré'}
              </span>
              {result && myVote === s && <span className="own-vote"> · votre vote</span>}
            </span>
          </button>
        );
      })}

      <section className="pad" aria-live="polite">
        {bout.status === 'REVEALED' && result ? (
          <>
            <p className="status">
              {result.winner ? `${result.winner} l'emporte ${Math.max(result.akaVotes ?? 0, result.aoVotes ?? 0)} – ${Math.min(result.akaVotes ?? 0, result.aoVotes ?? 0)}` : 'Résultat'}
            </p>
            <p className="hint">En attente de la confirmation de la table.</p>
          </>
        ) : !scoring ? (
          <>
            <p className="status">{STATUS_TEXT[bout.status] ?? 'En attente'}</p>
            <p className="hint">La saisie s'ouvre quand les deux athlètes ont présenté leur kata.</p>
          </>
        ) : submitted ? (
          <>
            <p className="status">Notes envoyées</p>
            <Progress submitted={bout.progress.submitted} total={bout.progress.total} />
            <p className="hint">Les notes s'affichent quand les {bout.progress.total} juges ont noté.</p>
            <button className="btn send" onClick={edit}>
              Modifier mes notes
            </button>
          </>
        ) : (
          <>
            <p className="status">{pending ? 'Envoi en cours…' : STATUS_TEXT.SCORING}</p>
            <div className="keys" role="group" aria-label="Pavé numérique">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button key={d} className="key" disabled={!keysOpen || dq[focus] || !next.includes(d)} onClick={() => press(d)}>
                  {d}
                </button>
              ))}
              <button className="key small" disabled={!keysOpen} onClick={erase} aria-label="Effacer">
                Effacer
              </button>
              <button className="key" disabled={!keysOpen || dq[focus] || !next.includes('0')} onClick={() => press('0')}>
                0
              </button>
              <button className="key small" disabled={!keysOpen} aria-pressed={dq[focus]} onClick={toggleDq}>
                Disqualifier
              </button>
            </div>
            <p className="hint" data-tone={equal || error || pending ? 'warn' : undefined}>
              {pending
                ? 'Connexion perdue : vos notes partiront dès que le serveur répond.'
                : error
                  ? error
                  : equal
                    ? ERROR_TEXT.EQUAL_SCORES
                    : confirmDq
                      ? 'Confirmez la disqualification en appuyant à nouveau sur Envoyer.'
                      : aka !== null && ao !== null
                        ? 'Vérifiez vos notes, puis envoyez. Touchez un côté pour corriger.'
                        : `Saisie : ${focus}. Notes de 5,0 à 10,0.`}
            </p>
            <button className="btn btn-primary send" disabled={!canSend || !!pending} onClick={send}>
              {confirmDq ? 'Confirmer et envoyer' : 'Envoyer mes notes'}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

function Progress({ submitted, total }: { submitted: number; total: number }) {
  return (
    <div className="dots" role="img" aria-label={`${submitted} juges sur ${total} ont noté`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} data-on={i < submitted} />
      ))}
    </div>
  );
}
