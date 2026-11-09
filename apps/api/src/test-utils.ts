import { SignJWT } from 'jose';

export const TEST_JWT_SECRET = 'test-secret-with-at-least-32-characters!!';

/** A Supabase-like access token signed with HS256. */
export const signToken = (
  sub: string,
  { secret = TEST_JWT_SECRET, aud = 'authenticated' } = {}
) =>
  new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience(aud)
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
