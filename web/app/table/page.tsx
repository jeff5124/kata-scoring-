'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useLive } from '@/lib/live';
import { format } from '@/lib/score';
import { errorText, useRequiredSession } from '@/lib/session';
import type { Bout, BracketStage, CompetitionDetail, CompetitionSummary, Kata, Side } from '@/lib/types';

const STATUS: Record<string, string> = {
  SCHEDULED: 'Prévu',
  CALLED: 'Appelé',
  AKA_PERFORMING: 'AKA en cours',
  AO_PERFORMING: 'AO en cours',
  SCORING: 'Notation',
  REVEALED: 'Révélé',
  CONFIRMED: 'Terminé',
  CANCELLED: 'Annulé',
};

const RESULT: Record<string, string> = {
  NORMAL: 'Décision des juges',
  DISQUALIFICATION: 'Disqualification',
  KIKEN: 'Kiken (absence ou abandon)',
  EXTRA_BOUT: 'Combat supplémentaire',
  WALKOVER: 'Forfait',
};

function remember(key: string, value: string | null) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* préférence non conservée */
  }
}

function recall(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export default function TablePage() {
  const { session, logout } = useRequiredSession(['TECHNICIAN', 'TATAMI_MANAGER'], '/table');
  const token = session?.token;

  const [competitions, setCompetitions] = useState<CompetitionSummary[]>([]);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [competition, setCompetition] = useState<CompetitionDetail | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [stages, setStages] = useState<BracketStage[] | null>(null);
  const [boutId, setBoutId] = useState<string | null>(null);
  const [bout, setBout] = useState<Bout | null>(null);
  const [katas, setKatas] = useState<Kata[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ───── chargement ─────
  useEffect(() => {
    if (!token) return;
    api<CompetitionSummary[]>('/competitions', { token })
      .then((list) => {
        setCompetitions(list);
        const saved = recall('table.competition');
        setCompetitionId(list.some((c) => c.id === saved) ? saved : (list[0]?.id ?? null));
      })
      .catch((e) => setError(errorText(e)));
    api<Kata[]>('/katas').then(setKatas).catch(() => undefined);
  }, [token]);

  const loadCompetition = useCallback(async () => {
    if (!token || !competitionId) return;
    const c = await api<CompetitionDetail>(`/competitions/${competitionId}`, { token });
    setCompetition(c);
    setCategoryId((cur) => {
      if (cur && c.categories.some((x) => x.id === cur)) return cur;
      const saved = recall('table.category');
      return c.categories.find((x) => x.id === saved)?.id ?? c.categories.find((x) => x.drawn)?.id ?? c.categories[0]?.id ?? null;
    });
  }, [token, competitionId]);

  useEffect(() => {
    remember('table.competition', competitionId);
    loadCompetition().catch((e) => setError(errorText(e)));
  }, [competitionId, loadCompetition]);

  const loadBracket = useCallback(async () => {
    if (!categoryId) return setStages(null);
    try {
      const b = await api<{ stages: BracketStage[] }>(`/categories/${categoryId}/bracket`);
      setStages(b.stages);
    } catch {
      setStages([]); // pas encore de tirage
    }
  }, [categoryId]);

  const loadBout = useCallback(async () => {
    if (!boutId) return setBout(null);
    setBout(await api<Bout>(`/bouts/${boutId}`));
  }, [boutId]);

  useEffect(() => {
    remember('table.category', categoryId);
    void loadBracket();
  }, [categoryId, loadBracket]);

  useEffect(() => {
    loadBout().catch((e) => setError(errorText(e)));
  }, [loadBout]);

  // choisir automatiquement le prochain combat à jouer
  useEffect(() => {
    if (!stages || boutId) return;
    const all = stages.flatMap((s) => s.bouts);
    const next =
      all.find((b) => b.status !== 'SCHEDULED' && b.status !== 'CONFIRMED' && b.status !== 'CANCELLED') ??
      all.find((b) => b.status === 'SCHEDULED' && b.aka_entry_id && b.ao_entry_id);
    if (next) setBoutId(next.id);
  }, [stages, boutId]);

  const refresh = useCallback(() => {
    void loadBracket();
    void loadBout().catch(() => undefined);
  }, [loadBracket, loadBout]);

  const live = useLive(token, refresh);

  // ───── actions ─────
  async function act(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
      refresh();
      void loadCompetition();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const post = (path: string, body?: unknown) => api(path, { method: 'POST', token, body });
  const category = competition?.categories.find((c) => c.id === categoryId) ?? null;

  /** Après un repêchage ou un tableau final, les nouveaux combats rejoignent le tatami de la catégorie. */
  async function generate(path: string) {
    await post(path, {});
    if (category?.tatamiId) await post(`/categories/${category.id}/tatami`, { tatamiId: category.tatamiId });
  }

  const nextPlayable = useMemo(() => {
    const all = stages?.flatMap((s) => s.bouts) ?? [];
    return all.find((b) => b.status === 'SCHEDULED' && b.aka_entry_id && b.ao_entry_id && b.id !== boutId) ?? null;
  }, [stages, boutId]);

  if (!session) return null;

  return (
    <div className="desk">
      <header className="bar">
        <span className="ctx">
          <b>Table officielle</b>
          {competition ? ` · ${competition.name}` : ''}
        </span>
        <span className="link">
          <span className="dot" data-state={live.status} /> {live.status === 'online' ? 'En direct' : 'Hors ligne'}
        </span>
        <button className="linkbtn" onClick={logout}>
          Déconnexion
        </button>
      </header>

      <div className="desk-body">
        <aside className="desk-side">
          <label className="field">
            Compétition
            <select value={competitionId ?? ''} onChange={(e) => { setCompetitionId(e.target.value); setCategoryId(null); setBoutId(null); }}>
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Catégorie
            <select value={categoryId ?? ''} onChange={(e) => { setCategoryId(e.target.value); setBoutId(null); }}>
              {competition?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.drawn ? `(${c.confirmedCount}/${c.boutCount})` : '(pas de tirage)'}
                </option>
              ))}
            </select>
          </label>

          {category && !category.drawn && (
            <div className="note">
              Le tirage de cette catégorie n&apos;est pas fait ({category.entryCount} inscrits).
              <button className="btn btn-small" disabled={busy} onClick={() => act(() => post(`/categories/${category.id}/draw`, {}))}>
                Faire le tirage
              </button>
            </div>
          )}

          {category?.drawn && category.format === 'ELIMINATION_REPECHAGE' && (
            <button className="btn btn-small" disabled={busy} onClick={() => act(() => generate(`/categories/${category.id}/repechage`))}>
              Générer le repêchage
            </button>
          )}
          {category?.drawn && category.format === 'ROUND_ROBIN_THEN_ELIMINATION' && (
            <button className="btn btn-small" disabled={busy} onClick={() => act(() => generate(`/categories/${category.id}/knockout`))}>
              Générer le tableau final
            </button>
          )}

          <nav className="bouts">
            {stages?.map((s) => (
              <section key={s.id}>
                <h3>
                  {s.label} <small>panel de {s.panel_size}</small>
                </h3>
                {s.bouts.map((b) => (
                  <button key={b.id} className="bout-row" data-active={b.id === boutId} data-status={b.status} onClick={() => setBoutId(b.id)}>
                    <span className="bout-names">
                      <span className={b.winner_entry_id && b.winner_entry_id === b.aka_entry_id ? 'won' : ''}>
                        <i className="chip-aka" />
                        {b.aka_name ?? '—'}
                      </span>
                      <span className={b.winner_entry_id && b.winner_entry_id === b.ao_entry_id ? 'won' : ''}>
                        <i className="chip-ao" />
                        {b.ao_name ?? '—'}
                      </span>
                    </span>
                    <span className="bout-meta">
                      {b.group_label && <small>{b.group_label}</small>}
                      <span className="tag" data-status={b.status}>
                        {b.status === 'CONFIRMED' && b.aka_votes !== null ? `${b.aka_votes}–${b.ao_votes}` : STATUS[b.status]}
                      </span>
                    </span>
                  </button>
                ))}
              </section>
            ))}
          </nav>
        </aside>

        <main className="desk-main">
          {error && (
            <p role="alert" className="banner-error">
              {error} <button className="linkbtn" onClick={() => setError(null)}>Fermer</button>
            </p>
          )}
          {!bout ? (
            <div className="waiting">
              <h1>Aucun combat sélectionné</h1>
              <p>Choisissez un combat dans la liste.</p>
            </div>
          ) : (
            <BoutControl
              bout={bout}
              katas={katas}
              busy={busy}
              demo={!!competition?.demo}
              post={(path, body) => act(() => post(path, body))}
              onNext={nextPlayable ? () => setBoutId(nextPlayable.id) : null}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function BoutControl({
  bout,
  katas,
  busy,
  demo,
  post,
  onNext,
}: {
  bout: Bout;
  katas: Kata[];
  busy: boolean;
  demo: boolean;
  post: (path: string, body?: unknown) => void;
  onNext: (() => void) | null;
}) {
  const s = bout.status;
  const prep = s === 'SCHEDULED' || s === 'CALLED';
  const base = `/bouts/${bout.id}`;
  const ready = !!bout.aka.entryId && !!bout.ao.entryId;
  const kikenAllowed = ready && ['SCHEDULED', 'CALLED', 'AKA_PERFORMING', 'AO_PERFORMING'].includes(s);

  return (
    <div className="control">
      <div className="control-head">
        <div>
          <p className="eyebrow">
            {bout.category} · {bout.stage.label}
            {bout.group ? ` · ${bout.group}` : ''}
            {bout.isExtra ? ' · combat supplémentaire' : ''}
          </p>
          <h1>{STATUS[s]}</h1>
        </div>
        <Steps status={s} />
      </div>

      <div className="duo">
        {(['AKA', 'AO'] as Side[]).map((side) => {
          const c = side === 'AKA' ? bout.aka : bout.ao;
          const r = bout.result;
          const won = r?.winner === side;
          return (
            <section key={side} className="corner" data-side={side.toLowerCase()} data-won={won}>
              <p className="corner-label">{side}</p>
              <h2>{c.name ?? 'À déterminer'}</h2>
              <p className="muted">{c.country ?? ''}</p>
              {prep && c.entryId ? (
                <KataPicker katas={katas} value={c.kata} disabled={busy} onPick={(k) => post(`${base}/kata`, { side, kata: k })} />
              ) : (
                <p className="kata">{c.kata ? `${c.kata} · ${c.kataName}` : 'Kata non annoncé'}</p>
              )}
              {r && (
                <p className="votes">
                  {side === 'AKA' ? r.akaVotes : r.aoVotes} <small>votes</small>
                </p>
              )}
              {kikenAllowed && (
                <button
                  className="linkbtn"
                  disabled={busy}
                  onClick={() => confirm(`Déclarer KIKEN pour ${side} (${c.name}) ? L'adversaire gagne.`) && post(`${base}/kiken`, { absentSide: side })}
                >
                  Kiken {side}
                </button>
              )}
            </section>
          );
        })}
      </div>

      <section className="panel-box">
        <div className="panel-head">
          <h3>
            Panel ({bout.panel.length}/{bout.panelSize})
          </h3>
          {prep && ready && (
            <button className="btn btn-small" disabled={busy} onClick={() => post(`${base}/panel`)}>
              {bout.panel.length ? 'Retirer au sort' : 'Tirer le panel'}
            </button>
          )}
        </div>
        {bout.panel.length > 0 && (
          <ol className="panel-list">
            {bout.panel.map((p) => {
              const j = bout.result?.judges.find((x) => x.officialId === p.officialId);
              return (
                <li key={p.officialId} data-vote={j?.vote.toLowerCase()}>
                  <span>
                    J{p.position} {p.name ?? ''} {p.isChief && <small>(chef)</small>}
                  </span>
                  {j && (
                    <span className="judge-scores">
                      <b className="t-aka">{format(j.aka)}</b> <b className="t-ao">{format(j.ao)}</b>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {s === 'SCORING' && (
        <p className="progress">
          Notes reçues : <b>{bout.progress.submitted}</b> / {bout.progress.total}
        </p>
      )}
      {bout.result && (
        <p className="progress">
          {bout.result.resultType ? RESULT[bout.result.resultType] : ''} — vainqueur :{' '}
          <b>{bout.result.winner ? `${bout.result.winner} (${bout.result.winner === 'AKA' ? bout.aka.name : bout.ao.name})` : 'aucun'}</b>
        </p>
      )}

      <div className="actions">
        {s === 'SCHEDULED' && (
          <button className="btn btn-primary" disabled={busy || !ready} onClick={() => post(`${base}/advance`)}>
            Appeler les athlètes
          </button>
        )}
        {s === 'CALLED' && (
          <button className="btn btn-primary" disabled={busy} onClick={() => post(`${base}/advance`)}>
            AKA commence son kata
          </button>
        )}
        {s === 'AKA_PERFORMING' && (
          <button className="btn btn-primary" disabled={busy} onClick={() => post(`${base}/advance`)}>
            AKA a terminé · AO commence
          </button>
        )}
        {s === 'AO_PERFORMING' && (
          <button className="btn btn-primary" disabled={busy} onClick={() => post(`${base}/advance`)}>
            AO a terminé · ouvrir la notation
          </button>
        )}
        {s === 'SCORING' && demo && (
          <button className="btn" disabled={busy} onClick={() => post(`/admin/bouts/${bout.id}/simulate-scores`)}>
            Simuler les notes manquantes (démo)
          </button>
        )}
        {s === 'SCORING' && (
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={() => confirm('Les deux athlètes sont disqualifiés ? Un combat supplémentaire sera créé.') && post(`${base}/double-disqualification`)}
          >
            Double disqualification
          </button>
        )}
        {s === 'REVEALED' && (
          <button className="btn btn-primary" disabled={busy} onClick={() => post(`${base}/confirm`)}>
            Confirmer le résultat
          </button>
        )}
        {s === 'CONFIRMED' && onNext && (
          <button className="btn btn-primary" onClick={onNext}>
            Combat suivant
          </button>
        )}
      </div>
    </div>
  );
}

const STEPS = ['SCHEDULED', 'CALLED', 'AKA_PERFORMING', 'AO_PERFORMING', 'SCORING', 'REVEALED', 'CONFIRMED'];

function Steps({ status }: { status: string }) {
  const at = STEPS.indexOf(status);
  return (
    <ol className="steps" aria-label="Étapes du combat">
      {STEPS.slice(1).map((st, i) => (
        <li key={st} data-done={i + 1 <= at} data-current={i + 1 === at}>
          {STATUS[st]}
        </li>
      ))}
    </ol>
  );
}

function KataPicker({ katas, value, disabled, onPick }: { katas: Kata[]; value: number | null; disabled: boolean; onPick: (k: number) => void }) {
  return (
    <select className="kata-select" value={value ?? ''} disabled={disabled} onChange={(e) => e.target.value && onPick(Number(e.target.value))}>
      <option value="">Annoncer le kata…</option>
      {katas.map((k) => (
        <option key={k.number} value={k.number}>
          {k.number} · {k.name}
        </option>
      ))}
    </select>
  );
}
