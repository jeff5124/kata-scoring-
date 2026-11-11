'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { errorText, useRequiredSession } from '@/lib/session';
import type { Athlete, CategorySummary, CompetitionDetail, CompetitionSummary, Entry, Federation } from '@/lib/types';

type Tab = 'categories' | 'athletes' | 'officials' | 'tatamis';
type Post = (path: string, body?: unknown, method?: string) => Promise<boolean>;

const FORMAT_LABEL: Record<string, string> = {
  ELIMINATION_REPECHAGE: 'Élimination avec repêchage',
  ROUND_ROBIN_THEN_ELIMINATION: 'Poules puis élimination',
  TWO_POOLS: 'Deux bassins',
};

const ROLE_LABEL: Record<string, string> = {
  JUDGE: 'Juge',
  TATAMI_MANAGER: 'Responsable de tatami',
  TECHNICIAN: 'Technicien (table)',
  RUNNER: 'Coureur',
  ANNOUNCER: 'Annonceur',
  TIMEKEEPER: 'Chronométreur',
  APPEAL_JURY: "Jury d'appel",
};

interface DemoResult {
  competitionId: string;
  accounts: { email: string; password: string; role: string }[];
}

/** Lit un formulaire en objet ; les champs vides sont omis. */
function formData(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  new FormData(form).forEach((v, k) => {
    if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim();
  });
  return out;
}

export default function AdminPage() {
  const { session, logout } = useRequiredSession(['ADMIN'], '/admin');
  const token = session?.token;
  const [competitions, setCompetitions] = useState<CompetitionSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [comp, setComp] = useState<CompetitionDetail | null>(null);
  const [federations, setFederations] = useState<Federation[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [tab, setTab] = useState<Tab>('categories');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<DemoResult | null>(null);

  const loadAll = useCallback(async () => {
    if (!token) return;
    const [list, feds, aths] = await Promise.all([
      api<CompetitionSummary[]>('/competitions', { token }),
      api<Federation[]>('/federations', { token }),
      api<Athlete[]>('/athletes', { token }),
    ]);
    setCompetitions(list);
    setFederations(feds);
    setAthletes(aths);
    setSelected((cur) => cur ?? list[0]?.id ?? null);
  }, [token]);

  const loadComp = useCallback(async () => {
    if (!token || !selected) return setComp(null);
    setComp(await api<CompetitionDetail>(`/competitions/${selected}`, { token }));
  }, [token, selected]);

  useEffect(() => {
    loadAll().catch((e) => setMessage({ kind: 'error', text: errorText(e) }));
  }, [loadAll]);
  useEffect(() => {
    loadComp().catch((e) => setMessage({ kind: 'error', text: errorText(e) }));
  }, [loadComp]);

  const post: Post = async (path, body, method = 'POST') => {
    setBusy(true);
    setMessage(null);
    try {
      await api(path, { method, token, body: body ?? {} });
      await Promise.all([loadAll(), loadComp()]);
      return true;
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  async function createDemo() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<DemoResult>('/admin/demo', { method: 'POST', token });
      setDemo(r);
      setSelected(r.competitionId);
      await loadAll();
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="admin">
      <header className="bar">
        <span className="ctx">
          <b>Administration</b>
        </span>
        <Link className="link" href="/table">Table</Link>
        <Link className="link" href="/display">Affichage</Link>
        <button className="linkbtn" onClick={logout}>
          Déconnexion
        </button>
      </header>

      <div className="admin-body">
        <section className="card">
          <div className="card-head">
            <h2>Compétitions</h2>
            <button className="btn btn-small" disabled={busy} onClick={createDemo}>
              Créer une démonstration
            </button>
          </div>
          {demo && (
            <div className="demo-box">
              <p>
                <b>Démonstration créée</b> : 8 athlètes, tirage fait, tatami 1. Comptes (un navigateur ou une fenêtre privée par juge) :
              </p>
              <ul>
                {demo.accounts.map((a) => (
                  <li key={a.email}>
                    <code>{a.email}</code> / <code>{a.password}</code> — {a.role === 'JUDGE' ? 'juge' : 'table'}
                  </li>
                ))}
              </ul>
              <p className="muted">
                Sur la table, le bouton « Simuler les notes manquantes » remplace les juges absents (démonstration uniquement).
              </p>
            </div>
          )}
          <div className="row">
            <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
              {competitions.length === 0 && <option value="">Aucune compétition</option>}
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.startsOn}
                </option>
              ))}
            </select>
          </div>
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = e.currentTarget;
              if (await post('/competitions', formData(f))) f.reset();
            }}
          >
            <input name="name" placeholder="Nom de la compétition" required />
            <input name="location" placeholder="Lieu" />
            <input name="startsOn" type="date" required aria-label="Date de début" />
            <button className="btn btn-small" disabled={busy}>
              Créer
            </button>
          </form>
        </section>

        {message && (
          <p role="alert" className={message.kind === 'error' ? 'banner-error' : 'banner-ok'}>
            {message.text}
          </p>
        )}

        {comp && (
          <>
            <nav className="tabs" role="tablist">
              {(
                [
                  ['categories', `Catégories (${comp.categories.length})`],
                  ['athletes', `Athlètes (${athletes.length})`],
                  ['officials', `Officiels (${comp.officials.length})`],
                  ['tatamis', `Tatamis (${comp.tatamis.length})`],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </nav>
            {tab === 'categories' && <Categories comp={comp} athletes={athletes} token={token!} busy={busy} post={post} />}
            {tab === 'athletes' && <Athletes athletes={athletes} federations={federations} busy={busy} post={post} />}
            {tab === 'officials' && <Officials comp={comp} federations={federations} busy={busy} post={post} />}
            {tab === 'tatamis' && <Tatamis comp={comp} busy={busy} post={post} />}
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── Catégories ─────────────

function Categories({ comp, athletes, token, busy, post }: { comp: CompetitionDetail; athletes: Athlete[]; token: string; busy: boolean; post: Post }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="card">
      <h2>Nouvelle catégorie</h2>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = e.currentTarget;
          const d = formData(f);
          if (await post(`/competitions/${comp.id}/categories`, { ...d, isU14: d.isU14 === 'on' })) f.reset();
        }}
      >
        <input name="name" placeholder="Nom (ex. Kata individuel senior femmes)" required />
        <select name="sex" required defaultValue="F" aria-label="Sexe">
          <option value="F">Femmes</option>
          <option value="M">Hommes</option>
        </select>
        <input name="ageMin" type="number" min={5} max={99} placeholder="Âge min" required />
        <input name="ageMax" type="number" min={5} max={99} placeholder="Âge max" />
        <select name="format" defaultValue="ELIMINATION_REPECHAGE" aria-label="Format">
          <option value="ELIMINATION_REPECHAGE">{FORMAT_LABEL.ELIMINATION_REPECHAGE}</option>
          <option value="ROUND_ROBIN_THEN_ELIMINATION">{FORMAT_LABEL.ROUND_ROBIN_THEN_ELIMINATION}</option>
        </select>
        <label className="check">
          <input type="checkbox" name="isU14" /> U14
        </label>
        <button className="btn btn-small" disabled={busy}>
          Ajouter
        </button>
      </form>

      <ul className="list">
        {comp.categories.map((c) => (
          <li key={c.id}>
            <div className="list-row">
              <button className="linkbtn strong" onClick={() => setOpen(open === c.id ? null : c.id)}>
                {open === c.id ? '▾' : '▸'} {c.name}
              </button>
              <span className="muted">
                {c.sex === 'F' ? 'F' : 'M'} · {c.ageMin}
                {c.ageMax ? `–${c.ageMax}` : '+'} ans · {FORMAT_LABEL[c.format]} · {c.entryCount} inscrits
                {c.drawn ? ` · tirage fait (${c.confirmedCount}/${c.boutCount} combats)` : ''}
              </span>
            </div>
            {open === c.id && <CategoryDetail category={c} comp={comp} athletes={athletes} token={token} busy={busy} post={post} />}
          </li>
        ))}
        {comp.categories.length === 0 && <li className="muted">Aucune catégorie.</li>}
      </ul>
    </section>
  );
}

function CategoryDetail({
  category,
  comp,
  athletes,
  token,
  busy,
  post,
}: {
  category: CategorySummary;
  comp: CompetitionDetail;
  athletes: Athlete[];
  token: string;
  busy: boolean;
  post: Post;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const load = useCallback(() => {
    api<Entry[]>(`/categories/${category.id}/entries`, { token }).then(setEntries).catch(() => setEntries([]));
  }, [category.id, token]);
  useEffect(load, [load, category.entryCount]);

  const entered = new Set(entries.map((e) => e.athleteId));
  const eligible = athletes.filter((a) => a.sex === category.sex && !entered.has(a.id));

  return (
    <div className="detail">
      <table className="grid">
        <thead>
          <tr>
            <th>Tête de série</th>
            <th>Athlète</th>
            <th>Pays</th>
            <th>Rang mondial</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{e.seed ?? '—'}</td>
              <td>{e.name}</td>
              <td>{e.country}</td>
              <td>{e.worldRank ?? '—'}</td>
              <td>
                {!category.drawn && (
                  <button className="linkbtn" disabled={busy} onClick={async () => (await post(`/entries/${e.id}`, undefined, 'DELETE')) && load()}>
                    Retirer
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!category.drawn && (
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = e.currentTarget;
            if (await post(`/categories/${category.id}/entries`, formData(f))) {
              f.reset();
              load();
            }
          }}
        >
          <select name="athleteId" required defaultValue="" aria-label="Athlète">
            <option value="" disabled>
              {eligible.length ? 'Inscrire un athlète…' : 'Aucun athlète disponible (onglet Athlètes)'}
            </option>
            {eligible.map((a) => (
              <option key={a.id} value={a.id}>
                {a.lastName} {a.firstName} ({a.country})
              </option>
            ))}
          </select>
          <input name="seed" type="number" min={1} max={128} placeholder="Tête de série" />
          <button className="btn btn-small" disabled={busy}>
            Inscrire
          </button>
        </form>
      )}

      <div className="row">
        {!category.drawn ? (
          <button className="btn btn-primary btn-small" disabled={busy || entries.length < 3} onClick={() => post(`/categories/${category.id}/draw`)}>
            Faire le tirage ({entries.length} inscrits)
          </button>
        ) : (
          <>
            <label className="field inline">
              Tatami
              <select
                value={category.tatamiId ?? ''}
                onChange={(e) => e.target.value && post(`/categories/${category.id}/tatami`, { tatamiId: e.target.value })}
              >
                <option value="">Non affecté</option>
                {comp.tatamis.map((t) => (
                  <option key={t.id} value={t.id}>
                    Tatami {t.number}
                  </option>
                ))}
              </select>
            </label>
            <Link className="btn btn-small" href="/table">
              Ouvrir la table
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── Athlètes et fédérations ─────────────

function Athletes({ athletes, federations, busy, post }: { athletes: Athlete[]; federations: Federation[]; busy: boolean; post: Post }) {
  return (
    <section className="card">
      <h2>Fédérations</h2>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = e.currentTarget;
          if (await post('/federations', formData(f))) f.reset();
        }}
      >
        <input name="name" placeholder="Nom de la fédération" required />
        <input name="country" placeholder="Pays (FRA)" maxLength={3} required className="short" />
        <button className="btn btn-small" disabled={busy}>
          Ajouter
        </button>
      </form>
      <p className="muted">{federations.map((f) => `${f.country} · ${f.name}`).join('  —  ') || 'Aucune fédération.'}</p>

      <h2>Nouvel athlète</h2>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = e.currentTarget;
          if (await post('/athletes', formData(f))) f.reset();
        }}
      >
        <input name="lastName" placeholder="Nom" required />
        <input name="firstName" placeholder="Prénom" required />
        <select name="sex" defaultValue="F" aria-label="Sexe">
          <option value="F">F</option>
          <option value="M">M</option>
        </select>
        <input name="birthDate" type="date" required aria-label="Date de naissance" />
        <select name="federationId" required defaultValue="" aria-label="Fédération">
          <option value="" disabled>
            Fédération…
          </option>
          {federations.map((f) => (
            <option key={f.id} value={f.id}>
              {f.country} · {f.name}
            </option>
          ))}
        </select>
        <input name="worldRank" type="number" min={1} placeholder="Rang mondial" className="short" />
        <button className="btn btn-small" disabled={busy}>
          Ajouter
        </button>
      </form>

      <table className="grid">
        <thead>
          <tr>
            <th>Athlète</th>
            <th>Sexe</th>
            <th>Naissance</th>
            <th>Pays</th>
            <th>Rang</th>
          </tr>
        </thead>
        <tbody>
          {athletes.map((a) => (
            <tr key={a.id}>
              <td>
                {a.lastName} {a.firstName}
              </td>
              <td>{a.sex}</td>
              <td>{a.birthDate}</td>
              <td>{a.country}</td>
              <td>{a.worldRank ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ───────────── Officiels ─────────────

function Officials({ comp, federations, busy, post }: { comp: CompetitionDetail; federations: Federation[]; busy: boolean; post: Post }) {
  return (
    <section className="card">
      <h2>Nouvel officiel</h2>
      <p className="muted">E-mail et mot de passe (8 caractères minimum) créent le compte de connexion : juge → tablette, technicien → table.</p>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = e.currentTarget;
          if (await post(`/competitions/${comp.id}/officials`, formData(f))) f.reset();
        }}
      >
        <input name="fullName" placeholder="Nom complet" required />
        <select name="role" defaultValue="JUDGE" aria-label="Fonction">
          {Object.entries(ROLE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select name="federationId" defaultValue="" aria-label="Fédération">
          <option value="">Neutre (aucune fédération)</option>
          {federations.map((f) => (
            <option key={f.id} value={f.id}>
              {f.country} · {f.name}
            </option>
          ))}
        </select>
        <input name="email" type="email" placeholder="E-mail (compte)" autoComplete="off" />
        <input name="password" type="password" placeholder="Mot de passe" autoComplete="new-password" />
        <button className="btn btn-small" disabled={busy}>
          Ajouter
        </button>
      </form>

      <table className="grid">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Fonction</th>
            <th>Pays</th>
            <th>Compte</th>
            <th>Disponible</th>
          </tr>
        </thead>
        <tbody>
          {comp.officials.map((o) => (
            <tr key={o.id}>
              <td>{o.fullName}</td>
              <td>{ROLE_LABEL[o.role] ?? o.role}</td>
              <td>{o.country ?? 'neutre'}</td>
              <td>{o.email ?? '—'}</td>
              <td>
                <input
                  type="checkbox"
                  checked={o.isAvailable}
                  disabled={busy}
                  aria-label={`${o.fullName} disponible`}
                  onChange={(e) => post(`/officials/${o.id}`, { isAvailable: e.target.checked }, 'PATCH')}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        {comp.officials.filter((o) => o.role === 'JUDGE' && o.isAvailable).length} juges disponibles — il en faut au moins 7 pour les poules et les
        médailles, sans conflit de fédération avec les athlètes.
      </p>
    </section>
  );
}

// ───────────── Tatamis ─────────────

function Tatamis({ comp, busy, post }: { comp: CompetitionDetail; busy: boolean; post: Post }) {
  return (
    <section className="card">
      <h2>Tatamis</h2>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = e.currentTarget;
          if (await post(`/competitions/${comp.id}/tatamis`, formData(f))) f.reset();
        }}
      >
        <input name="number" type="number" min={1} max={99} placeholder="Numéro" required className="short" />
        <button className="btn btn-small" disabled={busy}>
          Ajouter
        </button>
      </form>
      <ul className="list">
        {comp.tatamis.map((t) => (
          <li key={t.id} className="list-row">
            <b>Tatami {t.number}</b>
            <span className="muted">{comp.categories.filter((c) => c.tatamiId === t.id).map((c) => c.name).join(', ') || 'aucune catégorie'}</span>
            <Link className="link" href={`/display?tatami=${t.id}`}>
              Écran public de ce tatami →
            </Link>
          </li>
        ))}
        {comp.tatamis.length === 0 && <li className="muted">Aucun tatami.</li>}
      </ul>
    </section>
  );
}
