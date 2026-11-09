# 01 · Arquitectura objetivo

Decisiones tomadas con el usuario el 2026-11-09: **monorepo con frontend y backend separados**; backend en **Fastify + zod**. Justificación detallada en [ADR-001](../adr/ADR-001-monorepo-web-api.md).

## 1. Vista general

```
                    ┌────────────────────────── navegador ───────────────────────────┐
                    │  apps/web (Next.js 16, React 19)                                │
                    │   - UI, server components de lectura                             │
                    │   - Supabase JS SOLO para: Auth (sesión) y Realtime (suscripción)│
                    └───────────────┬───────────────────────────────▲─────────────────┘
                     HTTPS + Bearer │ JWT Supabase                  │ Realtime (RLS)
                                    ▼                               │
┌─ Meta Cloud ──┐  webhooks  ┌──────────────────────────────┐       │
│ WAHA (docker) │──────────► │ apps/api (Fastify + zod)     │       │
│ Mailgun       │◄────────── │  HTTP: /v1 app, /public/v1,  │       │
│ (FreePBX)     │  send/API  │        /webhooks/*           │       │
└───────────────┘            │  worker: pg-boss (jobs/cron) │       │
                             └──────────────┬───────────────┘       │
                                            ▼                       │
                             ┌──────────────────────────────┐       │
                             │ Supabase: Postgres + RLS,    │───────┘
                             │ Auth, Storage, Realtime      │
                             └──────────────────────────────┘
```

## 2. Estructura del monorepo

```
conexa/
  apps/
    web/                    Next.js — solo presentación
      src/app/              rutas (auth, dashboard); sin route handlers de negocio
      src/features/<mod>/   componentes + hooks por módulo (inbox, contacts, channels, teams…)
      src/lib/api-client.ts cliente HTTP tipado (usa contratos de packages/shared)
      src/lib/supabase/     auth + realtime únicamente
    api/                    Fastify
      src/server.ts         arranque HTTP
      src/worker.ts         arranque de workers pg-boss (mismo código, otro proceso)
      src/plugins/          auth (JWT Supabase), db, errors, rate-limit, raw-body
      src/modules/<mod>/    routes.ts (HTTP+zod) → service.ts (casos de uso) → repo.ts (SQL)
         accounts teams contacts conversations messages channels templates
         automations flows ai broadcasts webhooks-out public-v1 dashboard media
      src/channels/
         types.ts           ChannelAdapter, capacidades, InboundEvent, StatusEvent
         registry.ts        { whatsapp_cloud, whatsapp_waha, email_mailgun }
         whatsapp-cloud/    adapter.ts, webhook.ts (parser+firma), meta-api.ts
         waha/              adapter.ts, webhook.ts, client.ts, session.ts
         mailgun/           adapter.ts, inbound.ts, events.ts, client.ts, threading.ts
      src/pipeline/
         ingest.ts          ingestInbound(), ingestStatus()  — único camino de entrada
         outbound.ts        sendToConversation()            — único camino de salida
         events.ts          publicar eventos de dominio → jobs
      src/jobs/             handlers pg-boss (inbound.process, outbound.retry, channel.health, …)
  packages/
    shared/                 zod schemas de contratos API, enums, capacidades, tipos DTO
    db/                     migrations/ (las 059 de wacrm + nuevas), seed, tipos generados
  infra/
    docker-compose.yml      web, api, worker, waha (+ supabase local opcional)
  docs/conexa/
```

Gestor: **npm workspaces** (ya es el gestor del repo). Turborepo sólo si los tiempos de build lo justifican.

## 3. Reglas de dependencia (se validan con ESLint `import/no-restricted-paths`)

| Desde | Puede importar | No puede importar |
|---|---|---|
| `apps/web` | `packages/shared`, `@supabase/supabase-js` (solo `auth` y `channel()`) | `apps/api`, `packages/db`, service role, cualquier `.from('tabla')` |
| `apps/api/modules/*/routes` | su `service`, `packages/shared` | `repo` de otro módulo |
| `apps/api/modules/*/service` | repos, `pipeline/*`, otros services | Fastify (`req`, `reply`) |
| `apps/api/channels/*` | `channels/types`, su propio cliente HTTP | módulos de dominio (salvo vía `pipeline`) |
| `packages/shared` | `zod` | nada del runtime |

## 4. Autenticación y autorización
- **Auth sigue en Supabase Auth** (login, invitaciones, reset). El navegador mantiene la sesión con `@supabase/ssr`.
- Cada request a `apps/api` lleva `Authorization: Bearer <access_token>`. El plugin `auth` verifica el JWT (JWKS de Supabase) y carga `{ userId, accountId, role, teamIds }`.
- Acceso a datos en la API con **Drizzle ORM** sobre migraciones SQL ([ADR-003](../adr/ADR-003-acceso-datos-drizzle.md)), en dos modos:
  - `withUser(claims, tx)` — transacción con `role authenticated` + claims del JWT: **RLS se aplica** (defensa en profundidad; las políticas de visibilidad por equipo/canal viven en la BD, ver [06](06-usuarios-equipos-enrutamiento.md)).
  - `asService(tx)` — sin RLS, sólo para webhooks, workers y API pública (filtra por `account_id` en el repo, como hoy).
- Migraciones: SQL en `packages/db/migrations` (fuente de verdad, continúan desde 060); esquema Drizzle generado con `drizzle-kit pull`.
- API pública `/public/v1` con API keys (se migra tal cual desde `src/app/api/v1`).

## 5. Tiempo real
Se mantiene **Supabase Realtime** (`postgres_changes`) para empujar cambios al navegador; respeta RLS, por lo que la visibilidad por equipo se aplica sola. El navegador **sólo se suscribe**; toda escritura pasa por la API. (SSE propio desde la API queda como opción si Realtime no escala.)

## 6. Procesamiento asíncrono
**pg-boss** sobre el mismo Postgres (sin Redis adicional). Ver [ADR-004](../adr/ADR-004-cola-pg-boss.md).

| Job | Disparo | Qué hace |
|---|---|---|
| `inbound.process` | tras `ingestInbound` persistir el mensaje | flows → automations → IA → webhooks salientes (hoy en serie dentro del webhook Meta) |
| `outbound.send` | envíos de motores, reintentos | `sendToConversation` con reintento exponencial |
| `media.mirror` | adjunto entrante | copiar a Storage `chat-media` |
| `webhooks-out.deliver` | evento de dominio | entrega con reintentos (hoy 1 intento) |
| `channel.health` (cron 1 min) | — | estado sesiones WAHA, salud de números Cloud |
| `mailgun.reconcile` (cron 15 min) | — | Events API para estados perdidos |
| `automations.tick`, `flows.tick` (cron) | — | reemplazan `/api/automations/cron` y `/api/flows/cron` |

Los webhooks responden 200 tras **persistir** el evento crudo (`inbound_events`, ver [03](03-modelo-datos.md)) → idempotencia y reproceso.

## 7. Contratos compartidos
`packages/shared` define con zod: `SendMessageRequest`, `ConversationListQuery`, `ConversationDTO`, `MessageDTO`, `ChannelDTO`, `ChannelCapabilities`, enums. La API los usa para validar (`fastify-type-provider-zod`) y generar OpenAPI; la web los usa para tipar `api-client`. Un cambio de contrato rompe el typecheck en ambos lados.

## 8. Despliegue (MVP)
Un VPS/host Docker con `docker compose`: `web`, `api`, `worker`, `waha`, detrás de un proxy TLS (Caddy/Traefik). Supabase: **Supabase Cloud** (decidido; ver [10](10-plan-entrega.md)). WAHA **no** debe exponerse a internet: sólo `api` habla con él por red interna.

## 9. Tecnologías nuevas
| Paquete | Uso |
|---|---|
| `fastify`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/multipart`, `fastify-type-provider-zod`, `@fastify/swagger` | API |
| `pg-boss` | cola/cron |
| `drizzle-orm`, `drizzle-kit`, `postgres` (driver) | consultas tipadas y transacciones; esquema generado por introspección |
| `jose` | verificación JWT |
| `zod` | contratos |
| `mailparser`? | **no** — Mailgun ya entrega el correo parseado |

Todo lo demás (supabase-js, vitest, prettier, eslint) ya está en el repo.
