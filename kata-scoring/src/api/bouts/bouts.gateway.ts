import { HttpException, Inject, type OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { Subscription } from 'rxjs';
import { RuleError, parseScore } from '../../rules/index.js';
import { BoutEvents } from './bout-events.js';
import { AuthService } from '../auth/auth.service.js';
import { bearer } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/roles.js';
import { BoutsService } from './bouts.service.js';
import { assertUuid } from './parse.js';

export const boutRoom = (boutId: string) => `bout:${boutId}`;
/** Salle de tous les combats : affichage public et tablettes des juges. */
export const ALL_ROOM = 'all';

type Ack = { ok: true; [key: string]: unknown } | { ok: false; code: string; message: string };

function toAck(e: unknown): Ack {
  if (e instanceof RuleError) return { ok: false, code: e.code, message: e.message };
  if (e instanceof HttpException) {
    const r = e.getResponse();
    const code = typeof r === 'object' && r && 'code' in r ? String((r as { code: unknown }).code) : e.name;
    return { ok: false, code, message: e.message };
  }
  return { ok: false, code: 'INTERNAL', message: 'Erreur interne' };
}

/**
 * Temps réel d'un combat (namespace /live, une salle par combat).
 *  - client → serveur : `join` { boutId } · `score:submit` { boutId, aka, ao } (juge = celui du jeton)
 *  - serveur → salle  : `state` · `progress` (compteur seulement) · `revealed` (toutes les notes) · `confirmed`
 * Les notes ne sont diffusées qu'une fois tous les juges ayant noté (révélation simultanée).
 */
@WebSocketGateway({ namespace: '/live', cors: { origin: true } })
export class BoutsGateway implements OnGatewayInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private subscription?: Subscription;

  constructor(
    @Inject(BoutsService) private readonly bouts: BoutsService,
    @Inject(BoutEvents) private readonly events: BoutEvents,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  afterInit(server: Server): void {
    // Identification à la connexion : jeton dans `auth.token` (ou en-tête Authorization). Sans jeton valide on reste
    // spectateur : `join` est permis (affichage public), `score:submit` est refusé.
    server.use(async (socket, next) => {
      try {
        const token = (socket.handshake.auth?.token as string | undefined) ?? bearer(socket.handshake.headers.authorization);
        socket.data.user = (await this.auth.authenticate(token)) ?? undefined;
      } catch {
        socket.data.user = undefined;
      }
      next();
    });
    this.subscription = this.events.stream.subscribe((event) => {
      this.server.to(boutRoom(event.boutId)).to(ALL_ROOM).emit(event.type, event);
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /** Suit tous les combats : { } → reçoit les mêmes événements que `join`, pour tous les combats. */
  @SubscribeMessage('watch')
  async watch(@ConnectedSocket() client: Socket): Promise<Ack> {
    await client.join(ALL_ROOM);
    return { ok: true };
  }

  @SubscribeMessage('join')
  async join(@ConnectedSocket() client: Socket, @MessageBody() body: { boutId?: string }): Promise<Ack> {
    try {
      const boutId = assertUuid(body?.boutId, 'boutId');
      const bout = await this.bouts.getBout(boutId);
      await client.join(boutRoom(boutId));
      return { ok: true, bout };
    } catch (e) {
      return toAck(e);
    }
  }

  @SubscribeMessage('score:submit')
  async submit(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { boutId?: string; aka?: string | number; ao?: string | number },
  ): Promise<Ack> {
    try {
      const user = client.data.user as AuthUser | undefined;
      if (!user) return { ok: false, code: 'UNAUTHENTICATED', message: 'Connexion requise' };
      if (user.role !== 'JUDGE' || !user.officialId) return { ok: false, code: 'FORBIDDEN_ROLE', message: 'Réservé aux juges' };
      const boutId = assertUuid(body?.boutId, 'boutId');
      const officialId = user.officialId;
      if (body.aka == null || body.ao == null) return { ok: false, code: 'INVALID_BODY', message: 'aka et ao requis' };
      const result = await this.bouts.submitScore(boutId, officialId, parseScore(body.aka), parseScore(body.ao));
      // Le juge reçoit seulement l'avancement ; les valeurs ne sortent qu'à la révélation.
      return { ok: true, revealed: result.revealed, submitted: result.submitted, total: result.total };
    } catch (e) {
      return toAck(e);
    }
  }
}
