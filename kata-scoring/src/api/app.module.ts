import { Module } from '@nestjs/common';
import { BoutsModule } from './bouts/bouts.module.js';
import { DrawModule } from './draw/draw.module.js';
import { DatabaseModule } from './database.js';
import { AuthModule } from './auth/auth.module.js';
import { AdminModule } from './admin/admin.module.js';

@Module({ imports: [DatabaseModule, AuthModule, BoutsModule, DrawModule, AdminModule] })
export class AppModule {}
