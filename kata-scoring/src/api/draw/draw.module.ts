import { Module } from '@nestjs/common';
import { DrawController } from './draw.controller.js';
import { DrawService } from './draw.service.js';

@Module({ controllers: [DrawController], providers: [DrawService], exports: [DrawService] })
export class DrawModule {}
