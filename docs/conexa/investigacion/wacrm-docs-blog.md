# wacrm: resumen de la documentación y del blog (lo relevante para Conexa)

> Fecha de investigación: 2026-11-09. Conexa es un fork de wacrm (https://github.com/ArnasDon/wacrm), con licencia MIT.

Fuentes:
- Índice de la documentación: https://wacrm.tech/docs
- Arquitectura: https://wacrm.tech/docs/architecture
- Setup: https://wacrm.tech/docs/getting-started, https://wacrm.tech/docs/supabase-setup, https://wacrm.tech/docs/whatsapp-setup, https://wacrm.tech/docs/environment-variables
- Funcionalidades: https://wacrm.tech/docs/inbox, https://wacrm.tech/docs/members, https://wacrm.tech/docs/public-api
- Blog: https://wacrm.tech/blog/whatsapp-crm-for-support

---

## 1. Mapa de la documentación

- **Setup:** Getting started → Supabase setup → WhatsApp setup → Environment variables → Deploy on Hostinger → Automations cron.
- **Funcionalidades:** Inbox, Contacts, Pipelines (kanban de negocios), Templates, Broadcasts, Automations, Flows (chatbots con botones y handoff), AI Assistant (BYO key, borradores, auto-reply y base de conocimiento), Settings y Members.
- **Referencia:** Public API, Architecture, Troubleshooting y Changelog.

## 2. Arquitectura

**Stack:**
- Next.js 16 (App Router), React 19, Tailwind v4 y shadcn/base-ui.
- Supabase: Postgres, RLS, auth por email y password, Storage y Realtime, vía `@supabase/ssr`.
- Meta Cloud API directo, sin gateway.
- Cifrado con `node:crypto` AES-256-GCM.
- **Sin ORM, sin GraphQL y sin backend separado.**

**Estructura de carpetas:**
```
src/app/(auth)/                 login, signup, forgot-password
src/app/(dashboard)/            dashboard, inbox/, contacts/, pipelines/, broadcasts/, automations/, settings/
src/app/api/whatsapp/           webhook/, send/, broadcast/, config/, templates/, media/[id]/
src/app/api/automations/        engine, cron, CRUD
src/lib/supabase/               fábricas client/server/middleware
src/lib/whatsapp/               cliente Meta, encryption.ts, webhook-signature.ts, utils de teléfono
src/lib/automations/            engine.ts, steps-tree.ts, meta-send.ts, validación, templates
src/lib/rate-limit.ts, src/middleware.ts, supabase/migrations/, next.config.ts
```

**Flujo entrante (`POST /api/whatsapp/webhook`):**
1. `verifyMetaWebhookSignature`: HMAC-SHA256 del body con `META_APP_SECRET`, comparado con `X-Hub-Signature-256`. Responde 401 si falta el secreto o si la firma no coincide.
2. Un cliente `supabaseAdmin` con service role (que salta RLS) hace las escrituras.
3. Busca o crea el contacto por teléfono, busca o crea la conversación e inserta el mensaje.
4. Llama a `runAutomationsForTrigger(...)` (con `new_message` o palabra clave).
5. Responde 200; si no, Meta reintenta.

La documentación **no describe la idempotencia** frente a reintentos de Meta. Hay que verificarlo en el código (¿hay un unique en `wamid`?) y, si falta, agregarlo en Conexa.

**Flujo saliente (`POST /api/whatsapp/send`):**
1. Cliente Supabase con el JWT del usuario y `auth.getUser()`.
2. Rate limit `send:<uid>` de 60 por minuto. Es un `Map` en memoria del proceso; la documentación sugiere Redis o Upstash para escalar.
3. Lee `whatsapp_config` (con RLS) y descifra el token.
4. Llama a `sendTextMessage` o `sendTemplateMessage`.
5. Inserta el mensaje con `status='sent'` y devuelve el `wamid`.

La UI muestra una fila optimista que Realtime reemplaza por la fila real.

**Realtime:**
- Una suscripción a INSERT en `messages` y otra a `conversations` (estado, no leídos, último mensaje).
- Al recuperar el foco o reconectar el websocket se re-sincronizan los últimos 50 mensajes.

**Seguridad:**
- RLS en todas las tablas. La página de arquitectura dice `auth.uid() = user_id`, pero la de Members describe un modelo **por cuenta** (ver más abajo), así que la documentación de arquitectura parece desactualizada respecto a las migraciones más recientes. **Hay que revisar las políticas reales en `supabase/migrations/`.**
- Tokens cifrados con AES-256-GCM. Las filas legacy en CBC se "auto-curan" a GCM. La página de variables de entorno todavía dice CBC.
- Headers de seguridad en `next.config.ts`: HSTS, nosniff, XFO DENY y CSP en modo report-only.

**Cron:**
- No hay cola. Un pinger externo llama a `GET /api/automations/cron` con el header `x-cron-secret` = `AUTOMATION_CRON_SECRET` para drenar los pasos "Wait".

**Media:**
- Las entrantes se descargan al primer view desde Meta y se cachean en el bucket `message-media`.
- Las salientes van al bucket `chat-media`.
- Se sirven a través de `/api/whatsapp/media/[id]`.

## 3. Setup (lo que debemos replicar o adaptar)

- **Requisitos:** Node 20+ y npm. `cp .env.local.example .env.local`, luego `npm run dev` (puerto 3000).
- **Clave de cifrado:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` → `ENCRYPTION_KEY`. **No rotarla**, porque los tokens guardados quedarían ilegibles.
- **Migraciones:**
  - Están en `supabase/migrations/`, de `001_initial_schema.sql` a `009_message_actions.sql` (cuentas posteriores pueden tener más), y son idempotentes.
  - Se aplican con el SQL Editor o con `supabase db push`.
  - "Most common cause of 500 errors": no aplicar las migraciones nuevas después de actualizar.
- **Tablas base:** `profiles`, `contacts`, `conversations`, `messages`, `pipelines`, `broadcasts`, `automations` y `whatsapp_config`.
- **Auth:**
  - Activar "Confirm email" en producción.
  - Redirect URLs: `https://<dominio>/**` y `http://localhost:3000/**`.
  - Los emails enlazan a `<origin>/auth/callback`.
- **Variables de entorno:**
  - Requeridas: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY` y `META_APP_SECRET`.
  - Recomendada: `NEXT_PUBLIC_SITE_URL`.
  - Opcionales: `AUTOMATION_CRON_SECRET`, `META_APP_ID` (para plantillas con header de imagen), `AI_REQUEST_TIMEOUT_MS` y `AI_CONTEXT_MESSAGE_LIMIT`.
  - Las API keys de IA se guardan cifradas en la BD, no en variables de entorno.
- **WhatsApp:**
  - Credenciales: `phone_number_id`, `waba_id`, `access_token` (System User), verify token y `META_APP_SECRET`.
  - Webhook en `/api/whatsapp/webhook`, con los campos `messages` y `message_template_status_update` / `_quality_update` / `_components_update`.
  - **Restricción:** `UNIQUE(phone_number_id)`, es decir, un número por cuenta y por instancia. Es un único `whatsapp_config` por cuenta.

## 4. Members, roles y modelo de cuenta

- **Roles** (escalera plana): **Viewer** < **Agent** < **Admin** < **Owner** (uno solo por cuenta).
  - Agent: envía mensajes y edita contactos, deals, broadcasts, automations y flows.
  - Admin: además gestiona miembros y la configuración (WhatsApp, templates, pipelines, tags).
  - Owner: además transfiere la propiedad y borra la cuenta.
- **Datos por cuenta (account), no por usuario.** Todos los miembros ven la misma bandeja.
- **Invitaciones** solo por link (`/join/<token>`, con hash SHA-256 y expiración opcional); no se envían por email.
- **No hay asignación de conversaciones a agentes ni equipos** según la documentación de Members.

## 5. Inbox

- Lista ordenada por la última respuesta, con paginación de 50, búsqueda `ilike` (nombre, teléfono y preview; no busca en el cuerpo completo) y badges de no leídos.
- Estados: **Open**, **Pending** y **Closed**. Un nodo `handoff` de un Flow pone la conversación en Pending.
- "Notes" en la barra lateral del contacto: una libreta interna por **contacto**, no por conversación.
- Ventana de 24 h: el composer avisa cuando está cerrada y solo permite plantillas.
- Reacciones, respuestas citadas, media (fotos de 5 MB; videos y documentos de 16 MB; notas de voz grabadas en el navegador como Ogg/Opus, de máximo 5 min) e íconos de estado de entrega (sending, sent, delivered, read, failed con reintento).
- **No hay acciones masivas** (previstas para v0.3).

## 6. API pública

- Bearer `wacrm_live_…` (se guarda el hash SHA-256), con scopes `messages:send`, `messages:read`, `contacts:read`, `contacts:write`, `conversations:read`, `broadcasts:send` y `webhooks:manage`.
- Base `/api/v1`: `me`, `messages`, `contacts`, `conversations`, `conversations/{id}/messages`, `broadcasts` y CRUD de `webhooks`.
- Límite de 120 requests por minuto por key; el 429 incluye `Retry-After`.
- **Webhooks salientes:**
  - Eventos `message.received`, `message.status_updated` y `conversation.created`.
  - Firma `X-Wacrm-Signature: t=<unix>,v1=<hex>` = HMAC-SHA256 de `${t}.${rawBody}`.
  - Headers `X-Wacrm-Event` y `X-Wacrm-Webhook-Id`.
  - Payload: `{id, event, occurred_at, account_id, data}`.
  - **Es un buen patrón para reutilizar en Conexa** (por ejemplo, para el bridge del PBX o para integraciones con el ERP inmobiliario).

## 7. Blog: "WhatsApp CRM for support"

Lo que recomienda para equipos de soporte:
- **Bandeja compartida**: "Many agents, one number, no personal-phone chaos."
- **Equipos y roles**, con acceso acotado a quién ve qué.
- **Asignación y enrutamiento**: "Every conversation has a clear owner", con indicadores de colisión para que dos agentes no respondan el mismo hilo.
- **Notas internas** para dar contexto y para los handoffs: "Team-only context on any conversation for clean handoffs."
- **Plantillas y respuestas guardadas**, para dar respuestas rápidas y consistentes.
- **Automatización** que acusa recibo y clasifica de inmediato (incluso fuera de horario) y luego pasa la conversación a un humano. También ayuda a mantenerse dentro de la ventana de 24 h.
- **Métricas**: el **tiempo de primera respuesta** es "la métrica que define" un canal conversacional. wacrm tiene un dashboard de FRT por día de la semana contra una meta.
- **Historial** de conversaciones en la ficha del contacto.
- **Admite sus límites:** wacrm **no** tiene temporizadores de incumplimiento de SLA, encuestas CSAT/NPS, estados o flujos de ticket formales ni soporte multicanal (email, chat, redes). Para eso recomienda Chatwoot o Trengo. wacrm es la opción cuando WhatsApp es el canal principal y se quiere software libre autoalojado.

## 8. Implicaciones para el diseño de Conexa

Lo que el blog recomienda pero el producto no trae (según la documentación) es justamente el trabajo de Conexa:

| Necesidad | Estado en wacrm | Acción en Conexa |
|---|---|---|
| Multicanal (email, WAHA, voz) | Solo Meta Cloud API, un número por cuenta (`UNIQUE(phone_number_id)`) | Generalizar `whatsapp_config` a una tabla `channels(type, config_encrypted, …)` con N canales por cuenta. `conversations.channel_id` |
| Asignación a agente o equipo | No existe | `conversations.assignee_id`, `team_id`, reglas de enrutamiento (round-robin o por topic) e indicador de colisión (presence de Supabase Realtime) |
| Equipos | No existen (solo roles planos) | Tabla `teams` + `team_members`; RLS por equipo para el rol Agent |
| SLA | No existe | `sla_policies` (primera respuesta, siguiente respuesta, resolución, horario laboral y festivos de Colombia), con campos `first_response_due_at`/`resolution_due_at` en la conversación y un cron de incumplimientos |
| Estados de ticket | Open, Pending y Closed | Agregar `resolved` y opcionalmente `on_hold`; `pending` pausa el SLA |
| Notas internas por conversación | Notas por contacto | `messages.type='note'` en el hilo |
| Tipificación (help topics) y campos custom | No existen | `topics` + `field_definitions` (ver `osticket.md`) |
| CSAT | No existe | Encuesta al resolver (WhatsApp o email) |
| Idempotencia de webhooks | No documentada | Unique `(channel_id, external_id)` en `messages` |
| Rate limit en memoria | `Map` local | Upstash o tabla en Postgres si se despliega en serverless o con varias instancias |
| Cola de trabajos | No hay (cron por pinger) | Para la descarga de media de WAHA y Mailgun, transcripciones y SLA: usar pgmq/Supabase Queues o una tabla `jobs` + cron (decidido después: pg-boss, [ADR-004](../adr/ADR-004-cola-pg-boss.md)) |
| Webhooks salientes firmados | Existen (`X-Wacrm-Signature`) | Reutilizarlos para integraciones |
| Roles Viewer/Agent/Admin/Owner | Existen | Conservarlos y agregar "Supervisor" (ve todos los equipos y reasigna) si hace falta |

Riesgos del fork:
- La documentación de arquitectura y la de Members no coinciden (RLS por `user_id` frente a datos por cuenta). Hay que **leer las migraciones reales** antes de diseñar el esquema multi-canal.
- Mantener la compatibilidad con upstream es difícil si se renombran tablas. Conviene agregar tablas nuevas (`channels`, `teams`, `sla_policies`) y migrar `whatsapp_config` → `channels` con una vista de compatibilidad.
