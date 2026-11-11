import { CanActivate, ForbiddenException, Inject, Injectable, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service.js';
import { PUBLIC_KEY, ROLES_KEY, type Role } from './roles.js';

export function bearer(header: string | undefined): string | undefined {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return m?.[1];
}

/** Garde globale : jeton obligatoire sauf @Public(), puis contrôle du rôle (ADMIN passe partout). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true; // le WebSocket a son propre contrôle (bouts.gateway)
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = await this.auth.authenticate(bearer(req.headers?.authorization));
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Connexion requise' });
    req.user = user;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && user.role !== 'ADMIN' && !roles.includes(user.role)) {
      throw new ForbiddenException({ code: 'FORBIDDEN_ROLE', message: `Rôle ${user.role} non autorisé` });
    }
    return true;
  }
}
