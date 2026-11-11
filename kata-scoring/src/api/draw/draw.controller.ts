import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { Public, Roles } from '../auth/roles.js';
import { DrawService, type DrawOptions, type KnockoutOptions } from './draw.service.js';

@Controller('categories')
export class DrawController {
  constructor(@Inject(DrawService) private readonly draw: DrawService) {}

  /**
   * Tirage selon le format de la catégorie (élimination avec repêchage par défaut, 3.3.1 a) ou `{ format }`.
   * Options : poolPanelSize (poules, 7), knockoutPanelSize (éliminatoires, 5), medalPanelSize (médailles, 7).
   */
  @Roles('TECHNICIAN')
  @Post(':id/draw')
  drawPools(@Param('id') id: string, @Body() body: DrawOptions) {
    return this.draw.draw(id, body ?? {});
  }

  /** Tableau final à l'issue des poules : { knockoutPanelSize?, medalPanelSize?, cutoffWinners? }. */
  @Roles('TECHNICIAN')
  @Post(':id/knockout')
  knockout(@Param('id') id: string, @Body() body: KnockoutOptions) {
    return this.draw.generateKnockout(id, body ?? {});
  }

  /** Repêchage, quand les deux finales de poule sont jouées (élimination avec repêchage). */
  @Roles('TECHNICIAN')
  @Post(':id/repechage')
  repechage(@Param('id') id: string, @Body() body: DrawOptions) {
    return this.draw.generateRepechage(id, body ?? {});
  }

  @Public()
  @Get(':id/standings')
  standings(@Param('id') id: string) {
    return this.draw.standings(id);
  }

  @Public()
  @Get(':id/bracket')
  bracket(@Param('id') id: string) {
    return this.draw.bracket(id);
  }
}
