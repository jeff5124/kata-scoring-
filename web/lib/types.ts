export type Side = 'AKA' | 'AO';

export type BoutStatus =
  | 'SCHEDULED'
  | 'CALLED'
  | 'AKA_PERFORMING'
  | 'AO_PERFORMING'
  | 'SCORING'
  | 'REVEALED'
  | 'CONFIRMED'
  | 'CANCELLED';

export interface Competitor {
  entryId: string | null;
  kata: number | null;
  kataName: string | null;
  name: string | null;
  country: string | null;
  federation: string | null;
}

export interface RevealedJudge {
  position: number;
  officialId: string;
  aka: number;
  ao: number;
  vote: Side;
}

export interface ResultView {
  resultType: string | null;
  winnerEntryId: string | null;
  winner: Side | null;
  akaVotes: number | null;
  aoVotes: number | null;
  judges: RevealedJudge[];
}

export interface Bout {
  id: string;
  status: BoutStatus;
  isExtra: boolean;
  stage: { type: string; roundNo: number; label: string };
  category: string;
  group: string | null;
  position: number;
  aka: Competitor;
  ao: Competitor;
  panelSize: number;
  panel: { position: number; officialId: string; isChief: boolean; name?: string }[];
  progress: { submitted: number; total: number };
  result: ResultView | null;
}

export interface MyBout extends Bout {
  mine: { submitted: boolean };
}

export interface Session {
  token: string;
  user: { id: string; role: string; officialId: string | null };
}

export interface Kata {
  number: number;
  name: string;
}

export interface CompetitionSummary {
  id: string;
  name: string;
  location: string | null;
  startsOn: string;
  endsOn: string | null;
  demo: boolean;
}

export type CategoryFormat = 'ELIMINATION_REPECHAGE' | 'ROUND_ROBIN_THEN_ELIMINATION' | 'TWO_POOLS';

export interface CategorySummary {
  id: string;
  name: string;
  kind: string;
  sex: 'M' | 'F';
  ageMin: number;
  ageMax: number | null;
  isU14: boolean;
  format: CategoryFormat;
  entryCount: number;
  drawn: boolean;
  boutCount: number;
  confirmedCount: number;
  tatamiId: string | null;
}

export interface Official {
  id: string;
  fullName: string;
  role: string;
  isAvailable: boolean;
  federationId: string | null;
  country: string | null;
  email: string | null;
}

export interface CompetitionDetail extends CompetitionSummary {
  categories: CategorySummary[];
  tatamis: { id: string; number: number }[];
  officials: Official[];
}

export interface Federation {
  id: string;
  name: string;
  country: string;
}

export interface Athlete {
  id: string;
  firstName: string;
  lastName: string;
  sex: 'M' | 'F';
  birthDate: string;
  worldRank: number | null;
  federationId: string;
  country: string;
}

export interface Entry {
  id: string;
  seed: number | null;
  status: string;
  athleteId: string;
  name: string;
  country: string;
  worldRank: number | null;
}

export interface BracketBout {
  id: string;
  group_label: string | null;
  position: number;
  status: BoutStatus;
  is_extra: boolean;
  aka_entry_id: string | null;
  ao_entry_id: string | null;
  aka_kata: number | null;
  ao_kata: number | null;
  aka_votes: number | null;
  ao_votes: number | null;
  winner_entry_id: string | null;
  aka_name: string | null;
  ao_name: string | null;
}

export interface BracketStage {
  id: string;
  type: string;
  round_no: number;
  label: string;
  panel_size: number;
  bouts: BracketBout[];
}
