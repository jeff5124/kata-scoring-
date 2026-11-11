import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';

export type Role = 'ADMIN' | 'TECHNICIAN' | 'TATAMI_MANAGER' | 'JUDGE' | 'RUNNER' | 'COACH' | 'DISPLAY';
export const ROLES: readonly Role[] = ['ADMIN', 'TECHNICIAN', 'TATAMI_MANAGER', 'JUDGE', 'RUNNER', 'COACH', 'DISPLAY'];

export interface AuthUser {
  id: string;
  role: Role;
  officialId: string | null;
}

export const PUBLIC_KEY = 'auth:public';
export const ROLES_KEY = 'auth:roles';

/** Route ouverte sans jeton. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Route réservée à ces rôles (ADMIN passe toujours). Sans ce décorateur : tout utilisateur connecté. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  return ctx.switchToHttp().getRequest().user;
});

/** Ceux qui conduisent un combat (appel, katas, tirage, validation). */
export const OFFICE: Role[] = ['TECHNICIAN', 'TATAMI_MANAGER'];
