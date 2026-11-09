// Browser client for apps/api: sends the Supabase session as a Bearer token
// and validates every response against the @conexa/shared contracts.
import { ErrorResponse, MeResponse } from '@conexa/shared';
import type { z } from 'zod';
import { createClient } from '@/lib/supabase/client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export async function apiFetch<T extends z.ZodType>(
  path: string,
  schema: T,
  init: RequestInit = {}
): Promise<z.infer<T>> {
  const { data } = await createClient().auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session)
    headers.set('Authorization', `Bearer ${data.session.access_token}`);
  if (init.body && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');

  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    headers,
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ErrorResponse.safeParse(body);
    throw err.success
      ? new ApiError(res.status, err.data.error.code, err.data.error.message)
      : new ApiError(res.status, 'http_error', res.statusText);
  }
  return schema.parse(body);
}

/** One entry per endpoint; contracts live in packages/shared. */
export const api = {
  me: () => apiFetch('/v1/me', MeResponse),
};
