import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { AccountRole } from '@conexa/shared';
import { accounts, profiles } from '@conexa/db';
import type { Db } from './db';
import type { Env } from './env';
import { HttpError } from './errors';

export type AuthContext = {
  userId: string;
  accountId: string;
  accountName: string;
  role: AccountRole;
  /** Verified JWT payload; pass to `withUser` for RLS-scoped queries. */
  claims: JWTPayload;
};

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

export type VerifyToken = (token: string) => Promise<JWTPayload>;

/** Verifies Supabase access tokens: HS256 with the legacy secret, anything else via the project's JWKS. */
export function createVerifier(
  env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_JWT_SECRET'>
): VerifyToken {
  const secret = env.SUPABASE_JWT_SECRET
    ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
    : null;
  const jwks = env.SUPABASE_URL
    ? createRemoteJWKSet(
        new URL('/auth/v1/.well-known/jwks.json', env.SUPABASE_URL)
      )
    : null;
  if (!secret && !jwks)
    throw new Error('SUPABASE_URL or SUPABASE_JWT_SECRET is required');

  const getKey: JWTVerifyGetKey = (header, token) => {
    if (header.alg === 'HS256' && secret) return secret;
    if (header.alg !== 'HS256' && jwks) return jwks(header, token);
    throw new errors.JOSEAlgNotAllowed(`no key configured for ${header.alg}`);
  };
  return async (token) =>
    (await jwtVerify(token, getKey, { audience: 'authenticated' })).payload;
}

/** onRequest hook: Bearer token → `req.auth` (user + account membership). 401 / 403 otherwise. */
export function authenticate(db: Db, verify: VerifyToken) {
  return async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      throw new HttpError(401, 'unauthorized', 'Missing bearer token');

    let claims: JWTPayload;
    try {
      claims = await verify(header.slice('Bearer '.length));
    } catch {
      throw new HttpError(401, 'unauthorized', 'Invalid or expired token');
    }
    if (!claims.sub)
      throw new HttpError(401, 'unauthorized', 'Token has no subject');

    const [membership] = await db
      .select({
        accountId: profiles.accountId,
        role: profiles.accountRole,
        accountName: accounts.name,
      })
      .from(profiles)
      .innerJoin(accounts, eq(accounts.id, profiles.accountId))
      .where(eq(profiles.userId, claims.sub))
      .limit(1);
    if (!membership)
      throw new HttpError(403, 'forbidden', 'User has no account');

    req.auth = { userId: claims.sub, ...membership, claims };
  };
}
