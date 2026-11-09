# Plan de implementación del MVP de Conexa

Plan ejecutable: hitos → PRs con alcance, dependencias, migraciones y criterio de cierre. El _qué_ está en las specs (`spec/00`–`12`); los hitos y la definición de terminado, en [spec/10](spec/10-plan-entrega.md). Este documento fija el **orden de trabajo** y se actualiza al cerrar cada PR (columna Estado).

- Rama por hito (`conexa/h0.2-…`); PR contra `hherrera/wacrm` (nunca upstream). `main` siempre desplegable.
- Tamaños: **S** ≤ 2 días · **M** 3–5 días · **L** 6–10 días. Estimación para 1 desarrollador a tiempo completo con asistencia de IA; se recalibra al cerrar H0.2.
- Estados: ✅ hecho · 🔄 en curso · ⏳ pendiente · ⛔ bloqueado (por decisión de negocio).

## 1. Ruta y calendario

```
H0.1 ✅ ─► H0.2 ─┬─► H0.3 ──────────┬─► H3 ─► H4 ─► H5 (piloto)
                 └─► H1 ─► H2 ─► H2.5 ┘
```

| Hito | Contenido                                                 | Duración estimada | Semanas (acumulado)            |
| ---- | --------------------------------------------------------- | ----------------- | ------------------------------ |
| H0.1 | Monorepo + esqueleto backend (etapas 0.1–0.2)             | —                 | ✅ hecho                       |
| H0.2 | Canales, colas, pipelines, media privada (etapas 0.3–0.4) | 5–6 sem           | 1–6                            |
| H0.3 | Frontend sin BD directa + endurecimiento (0.5–0.6)        | 4–5 sem           | 7–11 (en paralelo con H1–H2.5) |
| H1   | WhatsApp Cloud multi-número                               | 2 sem             | 7–8                            |
| H2   | WAHA (QR)                                                 | 2–3 sem           | 9–11                           |
| H2.5 | Transcripción de notas de voz                             | 1 sem             | 12                             |
| H3   | Equipos y visibilidad                                     | 3 sem             | 13–15                          |
| H4   | Email Mailgun                                             | 3 sem             | 16–18                          |
| H5   | Inbox unificado, dashboard, despliegue y piloto           | 2–3 sem           | 19–21                          |

**Total: ~21 semanas** con el paralelo H0.3 ∥ H1–H2.5. Si solo trabaja una persona, el paralelo se convierte en intercalado y el total sube a **~25 semanas**.

## 2. Migraciones (numeración definitiva, por orden de merge)

| #   | Archivo                   | Hito / PR  | Contenido                                                                                                                                                                            |
| --- | ------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 060 | `data_api_grants`         | H0.1 ✅    | Grants de tablas a `authenticated`/`service_role`                                                                                                                                    |
| 061 | `channels`                | H0.2 · P1  | `channel_type`, `channel_status`, `channels`, `channel_secrets`; backfill 1 canal `whatsapp_cloud` por `whatsapp_config`; vista de compatibilidad                                    |
| 062 | `contact_identities`      | H0.2 · P1  | `identity_kind`, `contact_identities`, `contact_merge_suggestions`; backfill desde `phone`/`wa_user_id`/`email`; trigger de sincronización de principales; `contacts.phone` nullable |
| 063 | `conversation_channel`    | H0.2 · P1  | `channel_id`, `thread_key`, `subject`, `team_id`, `first_response_at`, `priority` (nullable) + backfill; `conversation_events`; `conversation_reads`; índice de inbox                |
| 064 | `messages_multichannel`   | H0.2 · P1  | `account_id`, `channel_id`, `direction`, `subject`, `body_html`, `metadata`, `inbound_event_id` + backfill; nuevos CHECK; `message_attachments`; `message_delivery_events`           |
| 065 | `inbound_events`          | H0.2 · P1  | `inbound_events` (+ columnas `raw_*` para email)                                                                                                                                     |
| 066 | `private_media`           | H0.2 · P7  | `chat-media` privado, límite 100 MB, backfill de `message_attachments` desde `messages.media_url`                                                                                    |
| 067 | `conversation_uniqueness` | H0.2 · P9  | Quita `idx_conversations_account_contact`; único `(channel_id, contact_id, thread_key)`. **Requisito de H1**                                                                         |
| 068 | `harden_channels`         | H0.3 · P16 | `channel_id` NOT NULL; secretos sólo en `channel_secrets`; se elimina `whatsapp_config` y `UNIQUE(account_id)`                                                                       |
| 069 | `templates_waba`          | H1 · P17   | `message_templates.waba_id` + backfill; broadcasts con `channel_id`                                                                                                                  |
| 070 | `transcripts`             | H2.5 · P23 | `media_transcripts`, `transcription_configs`                                                                                                                                         |
| 071 | `teams_access`            | H3 · P24   | `teams`, `team_members`, `channel_access`, FKs `team_id`; funciones `accessible_channel_ids()`/`my_team_ids()`; nueva RLS de conversaciones y mensajes; trigger de asignación válida |
| 072 | `email_raw`               | H4 · P28   | Bucket privado `email-raw`; índices de hilo (`messages.external_id` por canal)                                                                                                       |

Reglas: cada migración es idempotente, pasa el job `migrations` de CI y va seguida de `npm run db:pull -w @conexa/db` en el mismo PR. Las tablas nuevas llevan RLS; los grants llegan por los default privileges de 060.

## 3. Hitos y PRs

### H0.2 — Canales, colas y pipelines (etapas 0.3 + 0.4)

Objetivo: WhatsApp Cloud de un número funciona **igual que hoy**, pero servido por `apps/api` + worker, con cola, reintentos y media privada.

| PR                                    | Alcance                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Tam. | Depende | Estado |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- | ------ |
| **P1** Esquema de canales             | Migraciones 061–065 con backfill. Tests de backfill contra la BD local (canal creado por config, conversaciones y mensajes con `channel_id`, identidades). `db:pull`. El código viejo sigue funcionando (todo nullable).                                                                                                                                                                                                                                      | M    | —       | ⏳     |
| **P2** Contratos                      | `packages/shared`: `ChannelType`, `ChannelCapabilities`, configs por tipo (zod), `InboundEvent`/`StatusEvent` normalizados, payloads de cada cola ([11 §4](spec/11-colas-y-trabajos.md)), `ChannelDTO`.                                                                                                                                                                                                                                                       | S    | —       | ⏳     |
| **P3** Port de WhatsApp Cloud         | `apps/web/src/lib/whatsapp/{meta-api,wa-identity,phone-utils,message-status*,interactive,template-*}` y `encryption` → `apps/api/src/channels/whatsapp-cloud/` y `apps/api/src/lib/`, **con sus tests**. Mover, no reescribir. Web importa temporalmente desde el nuevo sitio si lo necesita.                                                                                                                                                                 | L    | P2      | ⏳     |
| **P4** Registro de canales y secretos | `channels/registry.ts` (`type → adapter`), repo de `channel_secrets` (AES-256-GCM, AAD = `channel_id`), `adapter.ts` de Cloud sobre `meta-api`.                                                                                                                                                                                                                                                                                                               | S    | P1, P3  | ⏳     |
| **P5** Ingesta                        | Plugins `rawBody` y `rate-limit`. `POST/GET /webhooks/whatsapp-cloud`: firma → transacción `inbound_events` + `send('inbound.ingest')` → 200. `pipeline/ingest.ts` (extraído de `processMessage`): `resolveContact` → conversación por canal → mensaje idempotente → bump → reopen. Cola `status.apply` → `message_delivery_events` + estado monotónico. La ruta vieja `/api/whatsapp/webhook` pasa a proxy hacia la API. Tests con payloads reales grabados. | L    | P4      | ⏳     |
| **P6** Salida                         | `pipeline/outbound.ts::sendToConversation` (notas internas nunca salen) + cola `outbound.send` (`key_strict_fifo` por conversación, grupo por canal). `POST /v1/messages` → 202 con mensaje `queued`. El composer del inbox usa `api.messages.send`. Se borran los `meta-send.ts` duplicados que queden.                                                                                                                                                      | L    | P5      | ⏳     |
| **P7** Media privada                  | Migración 066. `GET /v1/attachments/:id/url` (firmada 15 min), `POST /v1/media/upload-url`. Cola `media.mirror` para la media entrante (fuera del request). Cloud envía por `media_id` (`POST /{phone_number_id}/media`). La UI pide URLs firmadas.                                                                                                                                                                                                           | M    | P6      | ⏳     |
| **P8** Motores                        | `automations`, `flows`, `ai`, webhooks salientes → `apps/api/src/modules/*` usando `sendToConversation`. Colas `inbound.process` y `webhooks.deliver`; schedules `automations.tick` y `flows.tick`. Se eliminan `after()` del webhook y `/api/automations/cron` y `/api/flows/cron`.                                                                                                                                                                          | L    | P6      | ⏳     |
| **P9** Cierre de H0.2                 | Migración 067. Handlers de DLQ (`*.dead` → marca `failed` + notificación a admins). `GET /health/queues`. `maintenance.cleanup` real (purga `inbound_events` > 30 días).                                                                                                                                                                                                                                                                                      | S    | P5–P8   | ⏳     |

**Demo de cierre (sandbox de Meta, contra Supabase Cloud y la API en el VPS):** recibir texto e imagen; responder; ticks; flow activo; auto-reply IA; un reintento visible tras cortar la red; la media no accesible por URL pública.
**Requisito previo de infraestructura:** VPS + dominio `api.conexa…` con TLS para que Meta alcance el webhook (ver §4, I1–I2).

### H0.3 — Frontend desacoplado (etapas 0.5 + 0.6)

Un PR por módulo, en orden de riesgo. Cada PR: endpoints `apps/api/src/modules/<mod>/routes.ts` con contratos en `shared` → componente pasa a `api.<mod>.*` → se borra el route handler de Next equivalente → tests.

| PR      | Módulo                                                                                                                                                                           | Tam. | Estado |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| **P10** | **Inbox**: `GET /v1/conversations` (cursor, filtros en servidor), mensajes, `PATCH` (estado/asignado con `conversation_events`), `POST /read` (`conversation_reads`), reacciones | L    | ⏳     |
| **P11** | Contactos (incluye identidades y fusión sugerida)                                                                                                                                | M    | ⏳     |
| **P12** | Settings: plantillas, etiquetas, campos, quick replies, IA                                                                                                                       | M    | ⏳     |
| **P13** | Pipelines + broadcasts                                                                                                                                                           | M    | ⏳     |
| **P14** | Automations / flows (editores) + dashboard                                                                                                                                       | M    | ⏳     |
| **P15** | Notificaciones / presencia + regla ESLint que prohíbe `.from(`, `.rpc(` y `.storage` en `apps/web`                                                                               | S    | ⏳     |
| **P16** | Endurecimiento: migración 068, `middleware.ts` → `proxy.ts`, retirar `apps/web/src/app/api/**` restante                                                                          | S    | ⏳     |

**Cierre:** `grep -r "\.from(" apps/web/src` = 0 (salvo Realtime); E2E del inbox verde.

### H1 — WhatsApp Cloud multi-número ([04](spec/04-canal-whatsapp-cloud.md))

| PR      | Alcance                                                                                                                                                                                                               | Tam. | Estado |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| **P17** | CRUD de canales Cloud (`/v1/channels`): verificación, registro y suscripción parametrizados por canal (WC-1); listado con estado, calidad y tier (WC-2); desconectar (WC-8). UI en Settings → Canales. Migración 069. | M    | ⏳     |
| **P18** | Plantillas por WABA (WC-5), ventana de 24 h en servidor → `reply_window_closed` (WC-6), selección de canal en conversación saliente (WC-4), badge de canal en el inbox                                                | M    | ⏳     |
| **P19** | Broadcasts con número emisor; los mensajes de broadcast se registran en `messages` (WC-7). Schedule `channel.health` para Cloud (WC-9)                                                                                | S    | ⏳     |

**Cierre:** aceptación 1–5 de [04](spec/04-canal-whatsapp-cloud.md) con 2 números de 2 WABA. ⛔ Requiere D2.

### H2 — WAHA ([05](spec/05-canal-waha.md))

| PR      | Alcance                                                                                                                                                                                                                                                                                     | Tam. | Estado |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| **P20** | Contenedor WAHA ≥ 2026.6.1 (GOWS, volumen, API key hasheada, sin exposición pública) en compose. Cliente WAHA + ciclo de vida de sesión (crear, QR, código, reiniciar, desvincular, eliminar) y mapeo de estados. UI de alta con QR + advertencia de riesgo.                                | M    | ⏳     |
| **P21** | `POST /webhooks/waha`: HMAC-SHA512 + ventana de timestamp → `inbound_events`. Parser: `message.any` (in y `fromMe` desde el teléfono), `ack`, `reaction`, `revoked`, `session.status`; `@c.us`/`@lid`; ignorar grupos. `media.mirror` inmediato (`WHATSAPP_FILES_LIFETIME=3600`).           | L    | ⏳     |
| **P22** | Adapter de salida (texto, imagen, archivo, voz, seen, reacción) con URLs firmadas de 5 min; `groupConcurrency` 1 por canal + limitador; pausa del canal ante 463/475; envío bloqueado a contactos que nunca escribieron (configurable). `channel.health` para WAHA + notificación a admins. | M    | ⏳     |

**Cierre:** aceptación 1–6 de [05](spec/05-canal-waha.md). ⛔ Requiere D2 (aceptación formal del riesgo).

### H2.5 — Transcripción ([12 §4](spec/12-multimedia-transcripciones.md))

| PR      | Alcance                                                                                                                                                                                                                                                                                                                                                     | Tam. | Estado |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| **P23** | Migración 070. Cliente único compatible con OpenAI (`/v1/audio/transcriptions`, `language=es`, prompt con vocabulario editable). Cola `media.transcribe` (grupo por cuenta). `inbound.process` espera la transcripción (tope 2 min → `[audio]`). UI: texto bajo el reproductor, vista previa en la lista, búsqueda por tsvector. Settings de transcripción. | M    | ⏳     |

**Cierre:** aceptación 5–7 de [12](spec/12-multimedia-transcripciones.md). ⛔ Requiere D7 si se usa motor en la nube.

### H3 — Equipos ([06](spec/06-usuarios-equipos-enrutamiento.md))

| PR      | Alcance                                                                                                                                                                                | Tam. | Estado |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| **P24** | Migración 071 + **tests de RLS por rol** (agente de A no ve el canal de B ni por API, ni con su JWT directo a Supabase, ni por Realtime). Prueba de rendimiento con 50k mensajes.      | L    | ⏳     |
| **P25** | API y UI: CRUD de equipos y miembros (EQ-1, 2), acceso por canal y equipo por defecto (EQ-3)                                                                                           | M    | ⏳     |
| **P26** | Vistas del inbox: Mías / Sin asignar / Equipo / Todas con contadores (EQ-4); asignar, tomar y transferir con reglas y auditoría (EQ-5, 6, 9); disparar `conversation_assigned` (EQ-11) | M    | ⏳     |
| **P27** | Round-robin entre miembros en línea (EQ-7), notificaciones dirigidas (EQ-8), presencia por conversación (EQ-10)                                                                        | M    | ⏳     |

**Cierre:** aceptación 1–4 de [06](spec/06-usuarios-equipos-enrutamiento.md). ⛔ Requiere D4.

### H4 — Email Mailgun ([07](spec/07-canal-email-mailgun.md), [ADR-006](adr/ADR-006-email-raw-primero.md))

| PR      | Alcance                                                                                                                                                                                                                                                               | Tam. | Estado |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| **P28** | Migración 072. Alta de canal: verificar dominio, crear Route `store(notify)` y webhooks de eventos. `POST /webhooks/mailgun/inbound` (firma, token no repetido, 406 sin canal) → `email.fetch_raw` (.eml + SHA-256 en `email-raw`, snapshot parseado)                 | M    | ⏳     |
| **P29** | `inbound.ingest` para email: parseo MIME, hilo en 4 niveles, identidad email, adjuntos e inline `cid:`, auto-respuestas sin reabrir. Reproceso `POST /admin/inbound-events/:id/reprocess`. Tests con `.eml` reales (Gmail, Outlook, iPhone, rebote, fuera de oficina) | L    | ⏳     |
| **P30** | Adapter de salida (Re:, In-Reply-To/References, Reply-To con token, variables `conexa_*`, adjuntos, tracking). `POST /webhooks/mailgun/events` → `message_delivery_events` + estado; `complained`/`unsubscribed`; schedule `mailgun.reconcile`                        | M    | ⏳     |
| **P31** | UI: burbuja de email (cabecera, HTML saneado con DOMPurify en contenedor aislado, citas plegadas, adjuntos), composer de email (asunto, CC, firma), historial de estados, "descargar original"                                                                        | M    | ⏳     |

**Cierre:** aceptación 1–9 de [07](spec/07-canal-email-mailgun.md). ⛔ Requiere D3.

### H5 — Inbox unificado y piloto ([08](spec/08-inbox-unificado.md))

| PR      | Alcance                                                                                                                                                                                                                                                          | Tam. | Estado |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| **P32** | Composer y burbujas guiados sólo por `ChannelCapabilities` (sin `if whatsapp`); panel de contacto con identidades y todas sus conversaciones; conversación saliente eligiendo canal; mensajes `system` en el hilo                                                | M    | ⏳     |
| **P33** | Dashboard por canal y equipo: volumen, `first_response_at`, tiempos                                                                                                                                                                                              | M    | ⏳     |
| **P34** | Producción: despliegue en VPS (Caddy, compose con web/api/worker/WAHA), backups, alertas (`/health`, `/health/queues`, canal caído), dashboard de pg-boss tras auth, runbooks por canal en `docs/conexa/runbooks/`, prueba de carga (5.000 conversaciones < 1 s) | M    | ⏳     |
| **P35** | Piloto: alta de usuarios y equipos reales, capacitación, 2 semanas de operación con revisión semanal de los 5 criterios de éxito de [00](spec/00-vision-alcance-mvp.md)                                                                                          | —    | ⏳     |

## 4. Infraestructura (en paralelo, antes de que se necesite)

| #   | Tarea                                                                                             | Necesaria para           | Estado           |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------ | ---------------- |
| I1  | Proyecto Supabase Cloud (`sa-east-1`, Pro): aplicar 001–060, verificar que la web actual funciona | H0.2                     | ⏳ verificar 060 |
| I2  | VPS (4 vCPU / 8 GB) + DNS `conexa.` / `api.conexa.` + Caddy TLS; compose `web`/`api`/`worker`     | Demo H0.2 (webhook Meta) | ⏳               |
| I3  | Comprobar LISTEN/NOTIFY por Supavisor en modo sesión (si falla, pg-boss usa polling)              | H0.2                     | ⏳               |
| I4  | App Meta de desarrollo y número de prueba (sandbox)                                               | P5                       | ⏳               |
| I5  | Contenedor WAHA y un número de prueba descartable                                                 | H2                       | ⏳               |
| I6  | Dominio Mailgun verificado (SPF, DKIM, MX o reenvío)                                              | H4                       | ⏳               |
| I7  | Cuenta del motor de transcripción (o contenedor `speaches`)                                       | H2.5                     | ⏳               |

## 5. Decisiones de negocio y TI (con fecha límite)

| #   | Decisión                                                                                          | Responsable  | Necesaria antes de | Estado      |
| --- | ------------------------------------------------------------------------------------------------- | ------------ | ------------------ | ----------- |
| D1  | Supabase Cloud vs self-hosted                                                                     | TI           | —                  | ✅ Cloud    |
| D2  | Qué números van a Cloud API y cuáles a WAHA; aceptación escrita del riesgo de bloqueo con WAHA    | Negocio + TI | H1 (sem 7)         | ⏳          |
| D3  | Buzones del piloto; cambio de MX o reenvío; región Mailgun                                        | TI           | H4 (sem 16)        | ⏳          |
| D4  | Equipos del piloto, sus miembros y canales                                                        | Negocio      | H3 (sem 13)        | ⏳          |
| D5  | Drizzle                                                                                           | TI           | —                  | ✅ aceptado |
| D6  | Acceso a Sifinca (API o BD)                                                                       | TI           | Post-MVP (tickets) | ⏳          |
| D7  | Autorización de tratamiento de datos para transcripción en la nube (Ley 1581) o motor self-hosted | Legal        | H2.5 (sem 12)      | ⏳          |
| D8  | Usuarios del piloto y fecha de arranque                                                           | Negocio      | H5 (sem 19)        | ⏳          |

## 6. Reglas de trabajo en cada PR

- Definición de terminado de [spec/10](spec/10-plan-entrega.md#criterios-transversales-definición-de-terminado): tests, contratos en `shared`, OpenAPI, migración verificada en CI, i18n `es`/`en`, webhooks firmados e idempotentes, sin secretos en `config` ni en logs.
- Portar con los tests existentes; no reescribir lógica que ya funciona.
- Borrar el código viejo en el mismo PR que lo reemplaza (strangler sin doble mantenimiento).
- Actualizar la columna **Estado** de este documento y la nota de estado de la spec correspondiente al hacer merge.
