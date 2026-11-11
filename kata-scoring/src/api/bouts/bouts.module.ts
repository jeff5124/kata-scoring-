import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { RuleErrorFilter } from '../rule-error.filter.js';
import { BoutEvents } from './bout-events.js';
import { BoutsController } from './bouts.controller.js';
import { BoutsGateway } from './bouts.gateway.js';
import { BoutsService } from './bouts.service.js';

@Module({
  controllers: [BoutsController],
  providers: [BoutsService, BoutEvents, BoutsGateway, { provide: APP_FILTER, useClass: RuleErrorFilter }],
  exports: [BoutsService, BoutEvents],
})
export class BoutsModule {}
