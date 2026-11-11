import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { CurrentUser, Public, Roles, type AuthUser, type Role } from './roles.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() body: { email?: unknown; password?: unknown }) {
    return this.auth.login(body?.email, body?.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  /** Création d'un compte (ADMIN) : { email, password, role, officialId? } — officialId obligatoire pour un JUDGE. */
  @Roles('ADMIN')
  @Post('users')
  createUser(@Body() body: { email: string; password: string; role: Role; officialId?: string; competitionId?: string }) {
    return this.auth.createUser(body);
  }
}
