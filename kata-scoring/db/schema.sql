-- Schéma PostgreSQL : application de notation kata WKF 2026.0
-- Les notes sont stockées en dixièmes (76 = 7,6) ; 0 = disqualification.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────── Compétitions et catégories ─────────────

CREATE TABLE competitions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  location      text,
  starts_on     date NOT NULL,           -- 1er jour : sert au calcul de l'âge (8.1.1)
  ends_on       date,
  rules_version text NOT NULL DEFAULT '2026.0',
  -- surcharges autorisées par l'art. 9 : tailles de panel, format, règle de répétition en médaille...
  settings      jsonb NOT NULL DEFAULT '{
    "panelSizeRoundRobin": 7,
    "panelSizeElimination": 5,
    "panelSizeMedal": 7,
    "consecutiveRuleInMedalRound": false
  }'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE category_kind AS ENUM ('INDIVIDUAL', 'TEAM');
CREATE TYPE competition_format AS ENUM ('ELIMINATION_REPECHAGE', 'ROUND_ROBIN_THEN_ELIMINATION', 'TWO_POOLS');

CREATE TABLE categories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name           text NOT NULL,                       -- ex. « Kata individuel senior homme »
  kind           category_kind NOT NULL,
  sex            char(1) NOT NULL CHECK (sex IN ('M', 'F')),
  age_min        smallint NOT NULL,
  age_max        smallint,                            -- NULL = sans limite
  is_u14         boolean NOT NULL DEFAULT false,      -- 4 katas différents au lieu de 5 (5.2.2)
  format         competition_format NOT NULL DEFAULT 'ELIMINATION_REPECHAGE',
  UNIQUE (competition_id, name)
);

-- ───────────── Personnes et inscriptions ─────────────

CREATE TABLE federations (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name    text NOT NULL,
  country char(3) NOT NULL                              -- code pays à 3 lettres
);

CREATE TABLE athletes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  federation_id uuid NOT NULL REFERENCES federations(id),
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  sex           char(1) NOT NULL CHECK (sex IN ('M', 'F')),
  birth_date    date NOT NULL,
  world_rank    integer CHECK (world_rank > 0)          -- critère de départage n°4 (5.11)
);

CREATE TABLE teams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  federation_id uuid NOT NULL REFERENCES federations(id),
  name          text NOT NULL
);

CREATE TABLE team_members (
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES athletes(id),
  PRIMARY KEY (team_id, athlete_id)
);  -- 3 ou 4 membres : contrôlé par l'application (3.5.1)

CREATE TYPE entry_status AS ENUM ('ACTIVE', 'KIKEN', 'DISQUALIFIED_SHIKKAKU');

-- Une inscription = un athlète OU une équipe dans une catégorie
CREATE TABLE entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  athlete_id  uuid REFERENCES athletes(id),
  team_id     uuid REFERENCES teams(id),
  seed        smallint,                                  -- tête de série (3.4)
  status      entry_status NOT NULL DEFAULT 'ACTIVE',
  CHECK ((athlete_id IS NOT NULL) <> (team_id IS NOT NULL)),
  UNIQUE (category_id, athlete_id),
  UNIQUE (category_id, team_id)
);

-- ───────────── Katas (Annexe 1) ─────────────

CREATE TABLE katas (
  number smallint PRIMARY KEY CHECK (number BETWEEN 1 AND 102),  -- le numéro fait foi (6.3)
  name   text NOT NULL
);

-- ───────────── Officiels ─────────────

CREATE TYPE official_role AS ENUM ('JUDGE', 'TATAMI_MANAGER', 'TECHNICIAN', 'ANNOUNCER', 'RUNNER', 'TIMEKEEPER', 'APPEAL_JURY');

CREATE TABLE officials (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  federation_id  uuid REFERENCES federations(id),       -- conflit d'intérêts (4.8)
  full_name      text NOT NULL,
  role           official_role NOT NULL,
  is_available   boolean NOT NULL DEFAULT true
);

CREATE TABLE tatamis (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  number         smallint NOT NULL,
  manager_id     uuid REFERENCES officials(id),
  UNIQUE (competition_id, number)
);

-- ───────────── Phases, groupes, combats ─────────────

CREATE TYPE stage_type AS ENUM ('ROUND_ROBIN', 'ELIMINATION', 'REPECHAGE', 'MEDAL');

CREATE TABLE stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  type        stage_type NOT NULL,
  round_no    smallint NOT NULL,                         -- numéro du tour (règle de répétition des katas)
  label       text NOT NULL,                             -- « Poules », « Quarts de finale », « Bronze »...
  panel_size  smallint NOT NULL DEFAULT 7 CHECK (panel_size % 2 = 1),
  UNIQUE (category_id, round_no, type)
);

CREATE TABLE groups (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  label    text NOT NULL                                  -- « Groupe A », « Pool 1 »...
);

CREATE TABLE group_members (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES entries(id),
  PRIMARY KEY (group_id, entry_id)
);

CREATE TYPE bout_status AS ENUM (
  'SCHEDULED', 'CALLED', 'AKA_PERFORMING', 'AO_PERFORMING', 'SCORING', 'REVEALED', 'CONFIRMED', 'CANCELLED'
);
CREATE TYPE bout_result_type AS ENUM ('NORMAL', 'DISQUALIFICATION', 'KIKEN', 'EXTRA_BOUT', 'WALKOVER');
CREATE TYPE judging_mode AS ENUM ('ELECTRONIC', 'FLAGS');   -- 5.14 : jugement manuel par drapeaux

CREATE TABLE bouts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id         uuid NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  group_id         uuid REFERENCES groups(id),
  tatami_id        uuid REFERENCES tatamis(id),
  position         integer NOT NULL,                      -- ordre de passage
  aka_entry_id     uuid REFERENCES entries(id),           -- rouge, passe en premier (3.1.3)
  ao_entry_id      uuid REFERENCES entries(id),           -- bleu
  aka_kata         smallint REFERENCES katas(number),
  ao_kata          smallint REFERENCES katas(number),
  status           bout_status NOT NULL DEFAULT 'SCHEDULED',
  mode             judging_mode NOT NULL DEFAULT 'ELECTRONIC',
  panel_size       smallint NOT NULL CHECK (panel_size % 2 = 1),
  aka_votes        smallint,
  ao_votes         smallint,
  winner_entry_id  uuid REFERENCES entries(id),
  result_type      bout_result_type,
  is_extra         boolean NOT NULL DEFAULT false,         -- combat supplémentaire de départage
  next_bout_id     uuid REFERENCES bouts(id),               -- arbre d'élimination
  next_bout_side   varchar(3) CHECK (next_bout_side IN ('AKA', 'AO')),
  loser_next_bout_id uuid REFERENCES bouts(id),             -- demi-finale → combat pour le bronze (3.7.6)
  called_at        timestamptz,
  revealed_at      timestamptz,
  CHECK (aka_entry_id IS NULL OR ao_entry_id IS NULL OR aka_entry_id <> ao_entry_id)
);
CREATE INDEX bouts_stage_idx ON bouts (stage_id, position);
CREATE INDEX bouts_group_idx ON bouts (group_id);

-- Juges d'un combat (tirés au sort, 4.3) : position 1 à 7
CREATE TABLE bout_panel (
  bout_id     uuid NOT NULL REFERENCES bouts(id) ON DELETE CASCADE,
  official_id uuid NOT NULL REFERENCES officials(id),
  position    smallint NOT NULL CHECK (position BETWEEN 1 AND 7),
  is_chief    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (bout_id, official_id),
  UNIQUE (bout_id, position)
);

-- Une note par juge et par côté ; 0 = disqualification (5.4.1)
CREATE TABLE scores (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bout_id      uuid NOT NULL REFERENCES bouts(id) ON DELETE CASCADE,
  official_id  uuid NOT NULL REFERENCES officials(id),
  side         varchar(3) NOT NULL CHECK (side IN ('AKA', 'AO')),
  value_tenths smallint NOT NULL CHECK (value_tenths = 0 OR value_tenths BETWEEN 50 AND 100),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bout_id, official_id, side),
  FOREIGN KEY (bout_id, official_id) REFERENCES bout_panel (bout_id, official_id)
);

-- Vote de chaque juge en mode drapeaux (sans notes)
CREATE TABLE flag_votes (
  bout_id     uuid NOT NULL REFERENCES bouts(id) ON DELETE CASCADE,
  official_id uuid NOT NULL REFERENCES officials(id),
  vote        varchar(3) NOT NULL CHECK (vote IN ('AKA', 'AO')),
  PRIMARY KEY (bout_id, official_id),
  FOREIGN KEY (bout_id, official_id) REFERENCES bout_panel (bout_id, official_id)
);

-- Kata annoncé par chaque côté avant le passage ; validé par les juges (5.8 point 1)
CREATE TABLE kata_declarations (
  bout_id      uuid NOT NULL REFERENCES bouts(id) ON DELETE CASCADE,
  side         varchar(3) NOT NULL CHECK (side IN ('AKA', 'AO')),
  kata_number  smallint NOT NULL REFERENCES katas(number),
  declared_by  uuid REFERENCES officials(id),              -- coureur
  validated    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (bout_id, side)
);

-- ───────────── Incidents, amendes, protestations ─────────────

CREATE TABLE incidents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bout_id     uuid NOT NULL REFERENCES bouts(id) ON DELETE CASCADE,
  entry_id    uuid REFERENCES entries(id),
  type        text NOT NULL CHECK (type IN ('DISQUALIFICATION', 'KIKEN', 'SHIKKAKU', 'FINE_POLITICAL_RELIGIOUS', 'TIME_EXCEEDED', 'OTHER')),
  details     text,
  created_by  uuid REFERENCES officials(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE protest_status AS ENUM ('FILED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED');

CREATE TABLE protests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bout_id        uuid NOT NULL REFERENCES bouts(id),
  filed_by       text NOT NULL,                              -- entraîneur / représentant de la fédération
  federation_id  uuid REFERENCES federations(id),
  description    text NOT NULL,                              -- Annexe 3
  fee_paid_at    timestamptz,                                -- à régler dans les 5 minutes (7.1.5)
  status         protest_status NOT NULL DEFAULT 'FILED',
  decision_note  text,
  filed_at       timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz
);

CREATE TABLE protest_panel (
  protest_id  uuid NOT NULL REFERENCES protests(id) ON DELETE CASCADE,
  official_id uuid NOT NULL REFERENCES officials(id),
  seat        smallint NOT NULL CHECK (seat BETWEEN 1 AND 6),   -- 1-3 titulaires, 4-6 remplaçants (7.2)
  verdict     text CHECK (verdict IN ('ACCEPT', 'REJECT')),
  PRIMARY KEY (protest_id, official_id)
);

-- ───────────── Utilisateurs et audit ─────────────

CREATE TABLE app_users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid REFERENCES competitions(id) ON DELETE CASCADE,
  official_id    uuid REFERENCES officials(id),
  email          text UNIQUE,
  password_hash  text,
  role           text NOT NULL CHECK (role IN ('ADMIN', 'TECHNICIAN', 'TATAMI_MANAGER', 'JUDGE', 'RUNNER', 'COACH', 'DISPLAY')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Journal immuable : chaque action est tracée
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  user_id     uuid REFERENCES app_users(id),
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   uuid,
  before_data jsonb,
  after_data  jsonb
);

CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log est en écriture seule';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
