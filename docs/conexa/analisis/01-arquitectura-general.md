# 01 · Arquitectura general de wacrm (base de Conexa)

> Fork: `github.com/hherrera/wacrm` (upstream `ArnasDon/wacrm`, MIT, v0.8.0, ~900 commits).
> Análisis sobre el commit `c81299d`. Fecha: 2026-11-09.

## 1. Stack

| Capa | Tecnología | Notas |
|---|---|---|
| App | Next.js **16.3** (App Router, server actions, `after()`), React 19, TypeScript 6 | `AGENTS.md` advierte: Next 16 tiene cambios incompatibles; leer `node_modules/next/dist/docs/` antes de codificar. Middleware se llama `src/middleware.ts`. |
| UI | Tailwind v4, shadcn + `@base-ui/react`, lucide, recharts, Tremor (copiado en `components/tremor`), `@xyflow/react` (editor de flows), dnd-kit (kanban) | |
| Datos | Supabase: Postgres + Auth + Storage + Realtime + RLS | Sin ORM. Cliente `@supabase/supabase-js` directo. Migraciones SQL planas numeradas (`supabase/migrations/001..059`). |
| i18n | `next-intl`, catálogos `messages/{en,es,ko,pt}.json` | **Español ya existe** (`NEXT_PUBLIC_APP_LOCALE=es`). Locale por despliegue, no por usuario. |
| Tests | Vitest — **158 archivos `*.test.ts`** | Muy buena cobertura de lógica pura (parsers, builders, guards). |
| CI | `.github/workflows/ci.yml` (lint → typecheck → test → build) y `migrations.yml` (aplica migraciones sobre Postgres + `supabase/ci/verify-schema.sql`) | |
| Deploy | Hostinger Node / Vercel / Docker (`Dockerfile`, `docker-compose.yml`) | Un solo proceso Next. |
| Extra | `mcp-server/` (paquete npm separado, servidor MCP que consume `/api/v1`) | |

## 2. Organización del código

```
src/
  app/
    (auth)/            login, signup, forgot/reset password
    (dashboard)/       inbox, contacts, pipelines, broadcasts, automations, flows,
                       agents (IA), dashboard, notifications, settings
    api/
      whatsapp/        webhook, send, react, media, config, templates, broadcast, health
      automations/ flows/ ai/ contacts/ quick-replies/ account/ invitations/
      v1/              API pública (API keys con scopes)
    auth/callback, join/[token]
  components/<módulo>/ componentes cliente por módulo (inbox 5.1k líneas, settings 7.1k)
  lib/<módulo>/        lógica de dominio (whatsapp 13.4k líneas, flows 7k, automations 4.5k, ai 3.3k)
  hooks/ types/index.ts (tipos de dominio a mano, 714 líneas) i18n/
supabase/migrations/   001..059 (esquema + RLS + RPCs security definer)
mcp-server/            servidor MCP
docs/                  docs upstream (+ docs/conexa/ nuestro)
```

Patrón general: **route handler delgado → `lib/<módulo>` con la lógica → Supabase**. Las rutas de dashboard usan el cliente con sesión del usuario (RLS) y las de webhook/cron/motores usan `service_role` (sin RLS, filtrando por `account_id` en código).

## 3. Flujos principales

### Entrante (WhatsApp Cloud)
`POST /api/whatsapp/webhook` → verificar HMAC (`x-hub-signature-256`, `META_APP_SECRET` admite lista) → responder 200 inmediato → `after(processWebhook)`:
`phone_number_id → whatsapp_config → account_id` → identidad (phone/BSUID) → contacto (find-or-create, dedupe) → conversación (find-or-create, **1 por contacto**) → parse contenido (+ espejo de media en Storage) → upsert mensaje idempotente → `bump_conversation_on_inbound` RPC → reabrir → broadcasts (marcar reply) → **Flows → Automations → IA auto-reply** → webhooks salientes (`message.received`).
Detalle en [02-modelo-datos-y-canal-whatsapp.md](02-modelo-datos-y-canal-whatsapp.md).

### Saliente
Composer → `POST /api/whatsapp/send` → `lib/whatsapp/send-message.ts::sendMessageToConversation` (compartido con `/api/v1/messages`) → Meta Graph API → insert `messages` → actualizar preview de conversación → pausar flow activo.
Pero **automations, flows, IA y broadcasts tienen sus propios caminos de envío** (`lib/automations/meta-send.ts`, `lib/flows/meta-send.ts`, `lib/ai/auto-reply.ts`, `lib/whatsapp/broadcast-core.ts`), todos llamando a `meta-api.ts` directamente. Ver [05](05-automatizaciones-flows-ia-broadcasts-api.md).

### Estados de entrega
Webhook `statuses[]` → `message-status-sync.ts` (aplica estados aunque lleguen antes que el insert del mensaje: tabla de pendientes) → `messages.status` + `broadcast_recipients`.

### Tiempo real
Supabase Realtime sobre `messages` y `conversations` (publicación `supabase_realtime`, migración 001). Detalle en [04](04-inbox-tiempo-real-asignacion.md).

### Trabajo en segundo plano
**No hay cola ni workers.** Todo corre en:
- `after()` de Next (post-respuesta del webhook, `maxDuration = 60`).
- Endpoints cron protegidos por secreto: `/api/automations/cron`, `/api/flows/cron` (esperas, reintentos, programados). Los dispara un cron externo.
- Leases en DB para broadcasts (`broadcast-delivery-lease.ts`, `delivery_locked_at`).

Para Conexa esto es suficiente en el MVP (WAHA y Mailgun también entregan por webhook), pero la **sincronización periódica** (salud de sesiones WAHA, Events API de Mailgun, CDR de FreePBX) requerirá más endpoints cron o un worker (ver [06](06-mejoras-extensibilidad-multicanal.md)). *(Superado: se decidió cola pg-boss con worker propio desde la Fase 0 — [ADR-004](../adr/ADR-004-cola-pg-boss.md).)*

## 4. Multi-tenancy
Tabla `accounts`; la membresía vive en `profiles.account_id` + `profiles.account_role` (un usuario pertenece a **una sola** cuenta), roles `owner/admin/agent/viewer` (migración 017). Todas las tablas de negocio tienen `account_id` y RLS con `is_account_member(account_id, rol_minimo)`. `user_id` sobrevive en muchas tablas como "autor/creador" (legado del modelo 1 usuario = 1 tenant). Detalle en [03](03-cuentas-roles-seguridad.md).

Conexa será **una sola cuenta** (la inmobiliaria) con muchos usuarios: la tenencia ya está resuelta; lo que falta es **segmentación interna** (equipos, canales visibles por equipo/usuario).

## 5. Calidad del código — observaciones
**Fuerte**
- Comentarios extensos que explican el *porqué* con referencia a issues (#301, #363, #519…). Muy útil para entender carreras y casos borde.
- Idempotencia y concurrencia tomadas en serio: índices únicos como respaldo (`022`, `036`, `037`), RPCs atómicos (`bump_conversation_on_inbound`), manejo de `unique_violation`.
- Seguridad: AES-256-GCM para tokens, HMAC en webhooks, CSP, rate limit, guardas de tenencia (`conversation-scope.ts`, aviso GHSA).
- Mucha lógica pura extraída y testeada.

**Débil (para nuestro objetivo)**
- Todo el dominio de mensajería está **acoplado a WhatsApp Cloud**: la carpeta `lib/whatsapp` contiene a la vez transporte Meta *y* lógica genérica de inbox (resolve-conversation, send-message, message-status).
- `webhook/route.ts` = 1.389 líneas: parseo Meta + pipeline de dominio mezclados.
- 4–5 rutas de envío paralelas en lugar de un único servicio de salida.
- Tipos de dominio escritos a mano (`types/index.ts`) en vez de generados desde el esquema (`supabase gen types`).
- Supuestos "1 número por cuenta" y "1 conversación por contacto" fijados en la BD (ver 02).
- Sin cola: reintentos de envío y procesamiento pesado dependen del ciclo de vida de la request.

## 6. Qué conservar tal cual
Auth/cuentas/invitaciones, contactos (con extensión de identidades), etiquetas, campos personalizados, pipelines/deals, quick replies, notificaciones, presencia, API keys/API pública, webhooks salientes, IA (proveedores + KB), dashboard. Broadcasts con plantillas Meta pueden quedar **solo WhatsApp Cloud** en el MVP.
