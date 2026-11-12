'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Logo } from '../logo';
import { api } from '@/lib/api';
import { useLive } from '@/lib/live';
import { format } from '@/lib/score';
import type { Bout, Side } from '@/lib/types';

const ORDER: Record<string, number> = { REVEALED: 5, SCORING: 4, AO_PERFORMING: 3, AKA_PERFORMING: 2, CALLED: 1 };

const STATE_TEXT: Record<string, string> = {
  CALLED: 'Prochain combat',
  AKA_PERFORMING: 'AKA présente son kata',
  AO_PERFORMING: 'AO présente son kata',
  SCORING: 'Notation en cours',
};

function Board() {
  const params = useSearchParams();
  const wanted = params.get('bout');
  const tatami = params.get('tatami');
  const [bout, setBout] = useState<Bout | null | undefined>(undefined);
  const lastId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      if (wanted) {
        setBout(await api<Bout>(`/bouts/${wanted}`));
        return;
      }
      const active = await api<Bout[]>(`/bouts/active${tatami ? `?tatami=${encodeURIComponent(tatami)}` : ''}`);
      // le combat le plus avancé ; à égalité, le plus récent
      const pick = active.map((b, i) => ({ b, i })).sort((x, y) => (ORDER[y.b.status] ?? 0) - (ORDER[x.b.status] ?? 0) || y.i - x.i)[0]?.b;
      if (pick) {
        lastId.current = pick.id;
        setBout(pick);
      } else if (lastId.current) {
        // le dernier combat reste affiché, avec son résultat, jusqu'au suivant
        setBout(await api<Bout>(`/bouts/${lastId.current}`));
      } else {
        setBout(null);
      }
    } catch {
      /* la connexion reviendra : on garde l'affichage précédent */
    }
  }, [wanted, tatami]);

  const { status } = useLive(undefined, refresh);
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  if (bout === undefined) return <div className="idle"><p>Connexion…</p></div>;
  if (bout === null) {
    return (
      <div className="idle">
        <Logo size={160} title="Notation kata" />
        <h1>En attente du prochain combat</h1>
        <p>{status === 'offline' ? 'Connexion au serveur perdue, nouvelle tentative…' : 'Les notes apparaîtront ici.'}</p>
      </div>
    );
  }
  return <Duel bout={bout} />;
}

function Duel({ bout }: { bout: Bout }) {
  const result = bout.result;
  const revealed = result !== null && (bout.status === 'REVEALED' || bout.status === 'CONFIRMED');
  const judges = result?.judges ?? [];
  const winner: Side | null = result?.winner ?? null;
  const total = bout.panelSize;
  const slots = Array.from({ length: total }, (_, i) => {
    const seat = bout.panel[i];
    return { position: seat?.position ?? i + 1, isChief: seat?.isChief ?? false, judge: judges.find((j) => j.position === (seat?.position ?? i + 1)) };
  });

  const stateLine = revealed
    ? winner
      ? `${winner === 'AKA' ? bout.aka.name : bout.ao.name} l'emporte`
      : 'Résultat'
    : (STATE_TEXT[bout.status] ?? '');

  return (
    <main className="board" data-reveal={revealed} key={`${bout.id}-${revealed}`} style={{ '--n': total } as React.CSSProperties}>
      <header className="board-top">
        <span className="board-title">
          <Logo size={36} />
          <b>{bout.category}</b> · {bout.stage.label}
          {bout.group ? ` · ${bout.group}` : ''}
        </span>
        <span>Combat {bout.position}</span>
      </header>

      <section className="duel">
        {(['AKA', 'AO'] as Side[]).map((s) => {
          const c = s === 'AKA' ? bout.aka : bout.ao;
          const votes = s === 'AKA' ? result?.akaVotes : result?.aoVotes;
          return (
            <article key={s} className="fighter" data-side={s} data-win={revealed && winner ? String(winner === s) : undefined} data-lose={revealed && winner ? String(winner !== s) : undefined}>
              <span className="tag">{s}</span>
              <span className="name">{c.name ?? 'À venir'}</span>
              <span className="meta">
                {c.country ?? ''}
                {c.kata ? `${c.country ? ' · ' : ''}Kata ${c.kata}${c.kataName ? ` ${c.kataName}` : ''}` : ''}
              </span>
              {revealed && <span className="votes">{votes ?? 0}</span>}
            </article>
          );
        })}
      </section>

      <section className="panel-row">
        <p className="winner-line" style={revealed ? undefined : { display: 'none' }}>
          {stateLine}
          {result && winner ? ` · ${Math.max(result.akaVotes ?? 0, result.aoVotes ?? 0)} – ${Math.min(result.akaVotes ?? 0, result.aoVotes ?? 0)}` : ''}
        </p>
        {!revealed && <p className="state-line">{stateLine}{bout.status === 'SCORING' ? ` · ${bout.progress.submitted} / ${total}` : ''}</p>}
        <div className="slots">
          {slots.map((s, i) => {
            const j = s.judge;
            const state = revealed && j ? 'shown' : i < bout.progress.submitted ? 'in' : 'wait';
            const akaWins = j ? j.vote === 'AKA' : false;
            return (
              <div key={s.position} className="slot" style={{ '--i': i } as React.CSSProperties}>
                <span className="who" data-chief={s.isChief}>
                  {s.isChief ? `Juge ${s.position} (chef)` : `Juge ${s.position}`}
                </span>
                <span className="cell" data-side="AKA" data-state={state} data-vote={j ? String(akaWins) : undefined}>
                  {j ? format(j.aka) : ''}
                </span>
                <span className="cell" data-side="AO" data-state={state} data-vote={j ? String(!akaWins) : undefined}>
                  {j ? format(j.ao) : ''}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

export default function DisplayPage() {
  return (
    <Suspense>
      <Board />
    </Suspense>
  );
}
