import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException, type OnModuleInit } from '@nestjs/common';
import { Database } from '../database.js';
import { hashPassword, signToken, verifyPassword, verifyToken } from './crypto.js';
import { ROLES, type AuthUser, type Role } from './roles.js';

const TOKEN_TTL_SECONDS = 12 * 3600;

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(@Inject(Database) private readonly db: Database) {}

  private get secret(): string {
    const s = process.env.AUTH_SECRET;
    if (!s || s.length < 16) throw new Error('AUTH_SECRET manquant ou trop court (16 caractères minimum)');
    return s;
  }

  /** Crée le premier administrateur depuis ADMIN_EMAIL / ADMIN_PASSWORD si aucun utilisateur n'existe. */
  async onModuleInit(): Promise<void> {
    void this.secret; // échoue au démarrage plutôt qu'à la première connexion
    const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;
    if (!email || !password) return;
    const n = await this.db.pool.query('SELECT count(*)::int AS n FROM app_users');
    if (n.rows[0].n === 0) await this.createUser({ email, password, role: 'ADMIN' });
  }

  async login(email: unknown, password: unknown): Promise<{ token: string; user: AuthUser; expiresIn: number }> {
    if (typeof email !== 'string' || typeof password !== 'string') throw new UnauthorizedException({ code: 'BAD_CREDENTIALS' });
    const r = await this.db.pool.query(
      'SELECT id, role, official_id, password_hash FROM app_users WHERE lower(email) = lower($1)',
      [email.trim()],
    );
    const row = r.rows[0];
    // verifyPassword est appelé même si l'utilisateur n'existe pas (temps de réponse comparable)
    const ok = await verifyPassword(password, row?.password_hash ?? null);
    if (!row || !ok) throw new UnauthorizedException({ code: 'BAD_CREDENTIALS', message: 'Identifiants invalides' });
    const user: AuthUser = { id: row.id, role: row.role, officialId: row.official_id };
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    return { token: signToken({ sub: user.id, role: user.role, off: user.officialId, exp }, this.secret), user, expiresIn: TOKEN_TTL_SECONDS };
  }

  /** Vérifie le jeton ET relit l'utilisateur : un compte supprimé ou changé de rôle perd ses droits tout de suite. */
  async authenticate(token: string | undefined): Promise<AuthUser | null> {
    if (!token) return null;
    const p = verifyToken(token, this.secret);
    if (!p) return null;
    const r = await this.db.pool.query('SELECT id, role, official_id FROM app_users WHERE id = $1', [p.sub]);
    const row = r.rows[0];
    return row ? { id: row.id, role: row.role, officialId: row.official_id } : null;
  }

  async createUser(input: { email: string; password: string; role: Role; officialId?: string | null; competitionId?: string | null }): Promise<AuthUser> {
    if (!ROLES.includes(input.role)) throw new BadRequestException({ code: 'INVALID_USER', message: `Rôle inconnu : ${String(input.role)}` });
    if (typeof input.password !== 'string' || input.password.length < 8) {
      throw new BadRequestException({ code: 'INVALID_USER', message: 'Mot de passe : 8 caractères minimum' });
    }
    if (input.role === 'JUDGE' && !input.officialId) {
      throw new BadRequestException({ code: 'INVALID_USER', message: 'Un compte JUDGE doit référencer un officiel (officialId)' });
    }
    try {
      const r = await this.db.pool.query(
        `INSERT INTO app_users (email, password_hash, role, official_id, competition_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, role, official_id`,
        [input.email.trim().toLowerCase(), await hashPassword(input.password), input.role, input.officialId ?? null, input.competitionId ?? null],
      );
      return { id: r.rows[0].id, role: r.rows[0].role, officialId: r.rows[0].official_id };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException({ code: 'EMAIL_TAKEN' });
      throw e;
    }
  }
}
