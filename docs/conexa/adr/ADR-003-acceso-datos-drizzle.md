# ADR-003 · Acceso a datos: Drizzle ORM sobre migraciones SQL

- Estado: **propuesto** (pendiente de confirmación del equipo)
- Fecha: 2026-11-09

## Contexto
wacrm **no usa ORM**: el código consulta con `supabase-js` (PostgREST, `.from('tabla')`) y el esquema son 59 migraciones SQL escritas a mano (`supabase/migrations/001…059`) con mucha lógica en la BD: políticas RLS, funciones `SECURITY DEFINER` (`is_account_member`, `bump_conversation_on_inbound`, merges de duplicados), triggers, índices parciales.

Con el backend separado (`apps/api`, ver [ADR-001](ADR-001-monorepo-web-api.md)) tenemos conexión directa a Postgres, y aparecen necesidades que PostgREST cubre mal:
- **Transacciones** de varios pasos (ingesta: contacto + identidades + conversación + mensaje + evento).
- Consultas complejas del inbox (filtros por canal/equipo/estado, paginación por cursor) y del dashboard.
- Tipado fuerte de extremo a extremo (hoy `types/index.ts` está escrito a mano y se desincroniza).
- pg-boss ya necesita conexión directa.

## Opciones
| Opción | A favor | En contra |
|---|---|---|
| Seguir con `supabase-js` | Cero cambio; RLS automático con el JWT | Sin transacciones; tipos débiles; N+1; consultas complejas = RPCs SQL |
| **Drizzle ORM** | SQL-like, TS puro, sin runtime pesado; `drizzle-kit pull` introspecciona el esquema existente; transacciones; soporte documentado para RLS de Supabase (`set_config('request.jwt.claims')` + `set local role authenticated` por transacción) | Otra capa que aprender; sus migraciones generadas no cubren bien funciones/triggers |
| Prisma | Popular, buen DX | Motor/cliente generado pesado; RLS incómodo; peor con SQL avanzado (índices parciales, funciones); migraciones propias chocan con las 59 SQL |
| Kysely | Constructor de consultas tipado, muy fiel al SQL | Sin modelo de esquema; menos "baterías" que Drizzle |

## Decisión
1. **Fuente de verdad del esquema: migraciones SQL** en `packages/db/supabase/migrations` (continúan la numeración: 060, 061…). Se aplican con Supabase CLI (`supabase db push` / `migration up`) y CI las verifica como hoy (`migrations.yml`).
2. **Capa de consultas en `apps/api`: Drizzle ORM.** El esquema TS (`packages/db/src/schema.ts`) se **genera** con `drizzle-kit pull` tras cada migración (no se escribe a mano, no se usa `drizzle-kit generate`).
3. Dos modos de ejecución en el repo de datos:
   - `withUser(jwtClaims, tx => …)`: abre transacción, `set local role authenticated` + `set_config('request.jwt.claims', …, true)` → **RLS se aplica** igual que hoy (requests de usuarios).
   - `asService(tx => …)`: rol de servicio, sin RLS (webhooks, workers, API pública) → los repos filtran por `account_id` explícitamente.
4. `apps/web` no usa Drizzle ni Postgres: sólo la API.
5. `supabase-js` queda en la API únicamente para **Storage** y **Auth admin** (invitaciones).

## Consecuencias
- Transacciones reales en la ingesta y en cambios de estado con auditoría.
- Tipos generados → `packages/shared` deriva DTOs de ellos.
- El código portado de wacrm (`.from(...)`) se traduce a Drizzle módulo a módulo durante F0.5; mientras tanto puede convivir `supabase-js` en la API.
- Conexión: usar el *pooler* de Supabase en modo sesión para pg-boss y modo transacción para la API (o conexión directa en self-hosted).
