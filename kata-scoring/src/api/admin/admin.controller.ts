import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { OFFICE, Public, Roles } from '../auth/roles.js';
import { AdminService } from './admin.service.js';

type Body = Record<string, unknown>;

/**
 * Administration : lecture ouverte à la table (TECHNICIAN, TATAMI_MANAGER), écriture réservée à l'ADMIN
 * (sauf l'affectation des tatamis, faite aussi par la table après un repêchage).
 */
@Controller()
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Public()
  @Get('katas')
  katas() {
    return this.admin.katas();
  }

  @Roles(...OFFICE)
  @Get('competitions')
  competitions() {
    return this.admin.listCompetitions();
  }

  @Roles('ADMIN')
  @Post('competitions')
  createCompetition(@Body() body: Body) {
    return this.admin.createCompetition(body ?? {});
  }

  @Roles(...OFFICE)
  @Get('competitions/:id')
  competition(@Param('id') id: string) {
    return this.admin.getCompetition(id);
  }

  @Roles('ADMIN')
  @Post('competitions/:id/categories')
  createCategory(@Param('id') id: string, @Body() body: Body) {
    return this.admin.createCategory(id, body ?? {});
  }

  @Roles('ADMIN')
  @Post('competitions/:id/officials')
  createOfficial(@Param('id') id: string, @Body() body: Body) {
    return this.admin.createOfficial(id, body ?? {});
  }

  @Roles('ADMIN')
  @Post('competitions/:id/tatamis')
  createTatami(@Param('id') id: string, @Body() body: Body) {
    return this.admin.createTatami(id, body ?? {});
  }

  @Roles('ADMIN')
  @Patch('officials/:id')
  setAvailability(@Param('id') id: string, @Body() body: Body) {
    return this.admin.setOfficialAvailability(id, body ?? {});
  }

  @Roles(...OFFICE)
  @Get('federations')
  federations() {
    return this.admin.listFederations();
  }

  @Roles('ADMIN')
  @Post('federations')
  createFederation(@Body() body: Body) {
    return this.admin.createFederation(body ?? {});
  }

  @Roles(...OFFICE)
  @Get('athletes')
  athletes() {
    return this.admin.listAthletes();
  }

  @Roles('ADMIN')
  @Post('athletes')
  createAthlete(@Body() body: Body) {
    return this.admin.createAthlete(body ?? {});
  }

  @Roles(...OFFICE)
  @Get('categories/:id/entries')
  entries(@Param('id') id: string) {
    return this.admin.listEntries(id);
  }

  @Roles('ADMIN')
  @Post('categories/:id/entries')
  addEntry(@Param('id') id: string, @Body() body: Body) {
    return this.admin.addEntry(id, body ?? {});
  }

  @Roles('ADMIN')
  @Delete('entries/:id')
  removeEntry(@Param('id') id: string) {
    return this.admin.removeEntry(id);
  }

  /** { tatamiId } : tous les combats non terminés de la catégorie passent sur ce tatami. */
  @Roles('TECHNICIAN')
  @Post('categories/:id/tatami')
  assignTatami(@Param('id') id: string, @Body() body: Body) {
    return this.admin.assignTatami(id, body ?? {});
  }

  /** Compétition de démonstration complète (tirage fait), avec les identifiants des comptes créés. */
  @Roles('ADMIN')
  @Post('admin/demo')
  demo() {
    return this.admin.createDemo();
  }

  /** Démonstration uniquement : complète les notes manquantes du panel. */
  @Roles(...OFFICE)
  @Post('admin/bouts/:id/simulate-scores')
  simulate(@Param('id') id: string) {
    return this.admin.simulateScores(id);
  }
}
