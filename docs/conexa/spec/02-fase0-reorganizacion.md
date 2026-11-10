# 02 · Fase 0 — Reorganización de la base (frontend / backend)

**Objetivo:** dejar wacrm reorganizado como monorepo `web` + `api`, con modelo de canales genérico y pipelines únicos de entrada/salida, **sin perder funcionalidad** de lo que hoy funciona (WhatsApp Cloud de un número). Al final de F0 el producto se comporta igual, pero añadir un canal es escribir un adaptador.

Punto de partida medido (ver [análisis](../analisis/)):
- 56 route handlers en `src/app/api/**`.
- **48 archivos del navegador** usan `@/lib/supabase/client` con `.from(...)` (lecturas y escrituras directas: inbox, contactos, settings, broadcasts, pipelines, automations).
- 5 caminos de envío a Meta, pipeline entrante incrustado en `webhook/route.ts` (1.389 líneas).
- 158 archivos de test (Vitest) — red de seguridad principal.

## Estrategia: *strangler* por etapas, siempre desplegable

Cada etapa es uno o varios PR que dejan `main` funcionando. La app Next actual sigue sirviendo lo no migrado; la web va apuntando módulo a módulo al `api` nuevo.

### Etapa 0.1 — Monorepo sin cambio de comportamiento
- Mover el código actual a `apps/web` (tal cual). Migraciones a `packages/db/supabase/migrations`. Crear `packages/shared` vacío y `apps/api` con Fastify "hello" + `/health`.
- npm workspaces; scripts raíz `dev`, `build`, `test`, `typecheck`, `lint` que recorren workspaces.
- CI: mismo pipeline por workspace + job de migraciones apuntando a `packages/db`.
- `infra/docker-compose.yml` con `web` y `api`.
- **Criterio:** CI verde; la app se comporta exactamente igual.

### Etapa 0.2 — Esqueleto del backend
- Plugins: `auth` (verifica JWT Supabase con `jose` vía JWKS → `req.auth = {userId, accountId, role}`, reutiliza la lógica de `src/lib/auth/*`), `db` (`userDb(jwt)` y `adminDb`), `errors` (mapea `SendMessageError`-like a `{error:{code,message}}`), `rawBody` (para firmas), `rate-limit`.
- `fastify-type-provider-zod` + `@fastify/swagger` → `/docs` OpenAPI.
- pg-boss inicializado en `worker.ts`.
- `apps/web/src/lib/api-client.ts`: `fetch` con el token de la sesión, tipado con contratos de `packages/shared`.
- **Criterio:** test de integración "request autenticado → 200, sin token → 401".
- **Estado (hecho):**
  - `apps/api/src`: `env.ts` (zod), `db.ts` (`createDb` + `withUser(db, claims, fn)`: `role=authenticated` + `request.jwt.claims` en la transacción → RLS igual que PostgREST), `auth.ts` (HS256 con `SUPABASE_JWT_SECRET` y/o JWKS de `SUPABASE_URL`, `aud=authenticated`; 401/403; el proyecto cloud firma con ES256, así que allí se verifica por JWKS), `errors.ts`, `GET /v1/me`, `/docs`, CORS (`WEB_ORIGIN`).
  - Colas: `jobs/boss.ts` + `jobs/register.ts` + `worker.ts` (esquema `pgboss`, `maintenance.cleanup` diario 03:00 America/Bogota, aún sin trabajo real hasta `inbound_events`). El mismo contenedor corre como `worker` en compose. El worker usa `WORKER_DATABASE_URL` (Supavisor en modo sesión, 5432) y, si falta, `DATABASE_URL`.
  - `packages/db`: esquema Drizzle generado con `npm run db:pull -w @conexa/db` (`src/generated`, más un stub de `auth.users` y el tipo `tsvector`). `packages/shared`: `roles` (movido desde web), `ErrorResponse`, `MeResponse`.
  - Web: `src/lib/api-client.ts` (`NEXT_PUBLIC_API_URL`).
  - Tests: `apps/api/src/integration.test.ts` (200/401/403, RLS con `withUser`, encolado transaccional de pg-boss con commit y rollback). Corre con `DATABASE_URL`; CI levanta Postgres en el job `api-integration`.
  - Hallazgo: con los defaults actuales de Supabase, `authenticated` no tenía `SELECT/INSERT/UPDATE/DELETE` sobre las tablas, así que fallaba antes de llegar a RLS. Se corrige en la migración `060_data_api_grants.sql`. Verificado en el proyecto cloud: migraciones aplicadas, `verify-schema` OK, `/health`, `/v1/me` con JWT, aislamiento RLS, y el worker crea el esquema `pgboss` y el cron `maintenance.cleanup`.
  - Ninguna pantalla de la web llama todavía a `apps/api` (`apiFetch` sin uso): empieza en la etapa 0.5 (H0.3).
  - Pospuesto a 0.4 (llega con los webhooks): `rawBody` y `rate-limit`.

### Etapa 0.3 — Esquema de canales (migraciones 061–065)
Detalle en [03](03-modelo-datos.md). Backfill: un `channels` tipo `whatsapp_cloud` por cada `whatsapp_config`; `conversations.channel_id` y `messages.channel_id` rellenados; `contact_identities` desde `phone`/`wa_user_id`/`email`. El código viejo sigue funcionando (columnas nuevas nullable hasta 0.6).

### Etapa 0.4 — Pipelines únicos en `apps/api`
1. Portar `lib/whatsapp/meta-api.ts`, `wa-identity`, `phone-utils`, `message-status*`, `encryption`, `interactive`, `template-*` a `apps/api/src/channels/whatsapp-cloud/` (+ sus tests).
2. Escribir `pipeline/ingest.ts` extrayendo `processMessage` del webhook (identidad → contacto → conversación por canal → mensaje idempotente → bump → reopen) y encolar `inbound.process` (flows → automations → IA → webhooks-out).
3. Escribir `pipeline/outbound.ts::sendToConversation` a partir de `send-message.ts`, resolviendo el canal por `conversation.channel_id` y delegando en `registry[channel.type].send()`.
4. Mover el webhook Meta a `apps/api` en `POST /webhooks/whatsapp-cloud` (+ GET verificación). **Mantener** la URL vieja `/api/whatsapp/webhook` como proxy en web hasta reconfigurar Meta.
5. Motores (`automations`, `flows`, `ai`) portados a `apps/api/src/modules/*` usando `sendToConversation` (desaparecen `meta-send.ts` duplicados). Crons → pg-boss schedules.
- **Criterio:** los tests portados pasan; prueba E2E en sandbox de Meta: recibir, responder, ticks de estado, flow activo, auto-reply IA.

### Etapa 0.5 — Frontend sin acceso directo a la BD (por módulo)
Orden (por riesgo/valor): **inbox** → contactos → settings (canales, plantillas, tags, campos) → pipelines → broadcasts → automations/flows → dashboard → notificaciones/presencia.

Para cada módulo:
1. Endpoints en `apps/api/src/modules/<mod>/routes.ts` con contratos en `packages/shared`.
2. Reemplazar `supabase.from(...)` del componente por `api.<mod>.<op>()`.
3. Mover la lógica pura de `apps/web/src/lib/<mod>` que sea de dominio a `apps/api` (o a `packages/shared` si la usa la UI, p. ej. filtros, formateo).
4. Eliminar el route handler Next equivalente.

Inbox en concreto: `GET /v1/conversations` (paginado por cursor, filtros servidor), `GET /v1/conversations/:id/messages`, `PATCH /v1/conversations/:id` (estado, asignado — con auditoría), `POST /v1/conversations/:id/read`, `POST /v1/messages` (envío), `POST /v1/messages/:id/reactions`, `POST /v1/media/upload-url`.

Se permite en el navegador sólo: `supabase.auth.*` y `supabase.channel(...)` (Realtime). Regla ESLint que prohíbe `.from(` / `.rpc(` / `.storage` en `apps/web`.
- **Criterio:** `grep -r "\.from(" apps/web/src` = 0 (salvo realtime); E2E del inbox verde.

### Etapa 0.6 — Endurecimiento
- Columnas `channel_id` → `NOT NULL`; eliminar `whatsapp_config` y `whatsapp_config_account_id_key` (migración 069). El nuevo índice único de conversación (ver 03) se adelanta al cierre de H0.2 (migración 067) porque H1 lo necesita.
- Secretos de canal a `channel_secrets` sin SELECT para `authenticated`.
- `middleware.ts` → `proxy.ts` (Next 16).
- Tipos generados en `packages/db` (esquema Drizzle con `db:pull`, ya disponible desde 0.2), usados por los repos del API.
- Retirar `src/app/api/**` restante de `apps/web`.

## Mapa de destino de carpetas actuales

| Hoy (`src/…`) | Destino |
|---|---|
| `app/(auth)`, `app/(dashboard)`, `app/join`, `components/**`, `hooks/**`, `i18n`, `messages/` | `apps/web` |
| `app/api/**` | `apps/api/src/modules/**` (y `/webhooks/*`, `/public/v1/*`) |
| `lib/whatsapp/*` (Meta) | `apps/api/src/channels/whatsapp-cloud/` |
| `lib/whatsapp/{send-message,resolve-conversation,message-status*,conversation-scope}` | `apps/api/src/pipeline/` |
| `lib/{automations,flows,ai,webhooks,api,api-keys,contacts,dashboard,media,notifications,quick-replies,pipelines}` | `apps/api/src/modules/<mod>/` |
| `lib/inbox/*` (filtros, optimistic, unread-set, linkify) | `apps/web/src/features/inbox/` (UI) / `packages/shared` (filtros) |
| `lib/auth/*` | `apps/api/src/plugins/auth` + `apps/web` (sesión) |
| `lib/rate-limit.ts`, `encryption.ts` | `apps/api/src/plugins` / `apps/api/src/lib` |
| `types/index.ts` | `packages/shared` (DTOs) + `packages/db` (tipos generados) |
| `supabase/migrations` | `packages/db/supabase/migrations` |
| `mcp-server/` | `apps/mcp` (sin cambios, consume `/public/v1`) |

## Riesgos
| Riesgo | Mitigación |
|---|---|
| Regresiones al portar 13k líneas de `lib/whatsapp` | Portar con sus tests; no reescribir lógica, sólo mover y cambiar imports |
| Doble mantenimiento durante el strangler | Etapas cortas; un módulo a la vez; borrar el original en el mismo PR |
| Upstream wacrm sigue evolucionando | Tras F0 el fork diverge; `upstream` se usa sólo para *cherry-pick* de fixes de seguridad/Meta |
| Latencia extra navegador → api → Supabase | Mismo host/región; server components de Next pueden llamar al api por red interna |
