import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { BoutStatus, Side } from '../../rules/index.js';

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
  /** Notes de chaque juge : fournies seulement une fois le combat révélé. */
  judges: RevealedJudge[];
}

export type BoutEvent =
  | { type: 'state'; boutId: string; status: BoutStatus }
  /** Avancement de la saisie : jamais de valeurs de notes avant la révélation. */
  | { type: 'progress'; boutId: string; submitted: number; total: number }
  | { type: 'revealed'; boutId: string; result: ResultView }
  | { type: 'confirmed'; boutId: string; winnerEntryId: string | null };

@Injectable()
export class BoutEvents {
  private readonly subject = new Subject<BoutEvent>();
  readonly stream = this.subject.asObservable();

  emit(event: BoutEvent): void {
    this.subject.next(event);
  }
}
