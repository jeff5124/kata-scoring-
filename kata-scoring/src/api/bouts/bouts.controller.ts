import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, OFFICE, Public, Roles, type AuthUser } from '../auth/roles.js';
import { parseScore } from '../../rules/index.js';
import { BoutsService } from './bouts.service.js';
import { parseSide } from './parse.js';

@Controller('bouts')
export class BoutsController {
  constructor(@Inject(BoutsService) private readonly bouts: BoutsService) {}

  /** Combats en cours (écran d'affichage), éventuellement ceux d'un seul tatami : ?tatami=<id>. */
  @Public()
  @Get('active')
  active(@Query('tatami') tatami?: string) {
    return this.bouts.activeBouts(tatami);
  }

  /** Combats en cours où le juge connecté est dans le panel. */
  @Roles('JUDGE')
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    if (!user.officialId) throw new ForbiddenException({ code: 'NOT_A_JUDGE', message: "Ce compte n'est lié à aucun juge" });
    return this.bouts.boutsForJudge(user.officialId);
  }

  @Public()
  @Get(':id')
  get(@Param('id') id: string) {
    return this.bouts.getBout(id);
  }

  /** Tirage au sort du panel de juges. */
  @Roles(...OFFICE)
  @Post(':id/panel')
  panel(@Param('id') id: string) {
    return this.bouts.drawPanel(id);
  }

  /** Déclaration du kata d'un côté : { side: "AKA" | "AO", kata: 1..102 }. */
  @Roles(...OFFICE)
  @Post(':id/kata')
  async kata(@Param('id') id: string, @Body() body: { side?: unknown; kata?: unknown }) {
    const kata = Number(body?.kata);
    await this.bouts.declareKata(id, parseSide(body?.side), kata);
    return { ok: true };
  }

  /** Appel → AKA passe → AO passe → notation. */
  @Roles(...OFFICE)
  @Post(':id/advance')
  async advance(@Param('id') id: string) {
    return { status: await this.bouts.advance(id) };
  }

  /** Notes du juge connecté : { aka: "7.6", ao: "8.0" }. Le juge est celui du jeton, jamais celui du corps de la requête. */
  @Roles('JUDGE')
  @Post(':id/scores')
  scores(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: { aka?: string | number; ao?: string | number }) {
    if (!user.officialId) throw new ForbiddenException({ code: 'NOT_A_JUDGE', message: "Ce compte n'est lié à aucun juge" });
    if (body?.aka == null || body?.ao == null) {
      throw new BadRequestException({ code: 'INVALID_BODY', message: 'aka et ao sont requis' });
    }
    return this.bouts.submitScore(id, user.officialId, parseScore(body.aka), parseScore(body.ao));
  }

  @Roles(...OFFICE)
  @Post(':id/confirm')
  async confirm(@Param('id') id: string) {
    await this.bouts.confirm(id);
    return { ok: true };
  }

  /** Absence ou abandon : { absentSide: "AKA" | "AO" }. */
  @Roles(...OFFICE)
  @Post(':id/kiken')
  async kiken(@Param('id') id: string, @Body() body: { absentSide?: unknown }) {
    await this.bouts.kiken(id, parseSide(body?.absentSide));
    return { ok: true };
  }

  @Roles(...OFFICE)
  @Post(':id/double-disqualification')
  doubleDisqualification(@Param('id') id: string) {
    return this.bouts.declareDoubleDisqualification(id);
  }
}
