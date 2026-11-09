# 05 — Módulos secundarios y su acoplamiento a WhatsApp

> Alcance: automatizaciones, flows, IA, broadcasts, webhooks salientes, API pública v1, api-keys, MCP server, endpoints cron, dashboard, media/storage y contactos.
> Base: fork de wacrm (Next.js 16 App Router + Supabase). Solo lectura; las referencias son `ruta:línea` del código actual.
> Objetivo Conexa: varios números WhatsApp Cloud API, WhatsApp no oficial vía WAHA (QR), email vía Mailgun, bandeja unificada, equipos; después tickets y llamadas FreePBX.

---

## 0. Hallazgos críticos (lo que más condiciona el diseño)

| # | Hallazgo | Evidencia | Impacto en Conexa |
|---|---|---|---|
| H1 | **Un solo número WhatsApp por cuenta.** `whatsapp_config` tiene `UNIQUE(account_id)` y todos los caminos de envío lo leen con `.eq('account_id').single()`. | `supabase/migrations/017_account_sharing.sql:326`; `src/lib/automations/meta-send.ts:152`; `src/lib/flows/meta-send.ts:48-52`; `src/lib/whatsapp/send-message.ts:263-266,281`; `src/lib/whatsapp/broadcast-core.ts:116-120`; `src/app/api/whatsapp/broadcast/route.ts:127`; `src/lib/whatsapp/broadcast-resume.ts:229`; `src/app/api/whatsapp/react/route.ts:103` | Bloquea "varios números Cloud API". Con un segundo número, `.single()` falla y **todos** los envíos dejan de funcionar. |
| H2 | **Una conversación por contacto.** Índice único `(account_id, contact_id)` en `conversations`. | `036_conversation_contact_dedup.sql:31`; `webhook/route.ts:1320-1345`; `automations/engine.ts:1033-1038` | No hay forma de tener hilos separados por canal o número. Hay que decidir el modelo antes de tocar los motores. |
| H3 | **La identidad es el teléfono.** `contacts.phone NOT NULL`, dedup por `phone_normalized` (único por cuenta) y, desde la 040, por `wa_user_id` (BSUID). El email existe, pero sin índice ni dedup. | `001_initial_schema.sql:39,41`; `022_contact_phone_dedup.sql:30-32,118-120`; `040_contact_business_scoped_user_id.sql:28-45`; `src/lib/contacts/dedupe.ts` | Un contacto que solo tiene email no se puede crear por la API (`phone` es obligatorio) ni deduplicar. |
| H4 | **Cuatro implementaciones de envío distintas**, todas atadas a Meta. No hay una abstracción común. | ver §2 | Hay que unificarlas detrás de un `ChannelSender` antes de añadir WAHA y email. |
| H5 | **No hay cola.** Todo el trabajo en segundo plano corre en `after()` de Next.js o en dos endpoints cron que llama un scheduler externo. | `webhook/route.ts:269`; `api/automations/cron/route.ts`; `api/flows/cron/route.ts`; `docs/docker.md:72-76` | WAHA y Mailgun añaden webhooks entrantes. Conviene invertir ahora en un worker o cola mínima (p. ej. tabla `jobs` y pg-cron, o pgmq). |
| H6 | El webhook de Meta es el **único orquestador** de los motores. Flows, automatizaciones, IA y webhooks salientes se invocan en línea, uno tras otro. | `webhook/route.ts:809-933` | Este pipeline de post-ingesta hay que extraerlo a una función agnóstica de canal, `onInboundMessage(...)`. |

---

## 1. Modelo de ejecución en segundo plano

- **`after()` (next/server)** es el mecanismo principal. El webhook de Meta responde 200 y procesa dentro de `after()` (`src/app/api/whatsapp/webhook/route.ts:255-277`). Dentro, todo se hace con `await` en serie, a propósito: hubo pérdidas de trabajo con promesas sueltas (issue #301, comentarios en `route.ts:879-886,918-925`).
  - Broadcast vía API: `after(() => deliverBroadcast(...))` (`src/app/api/v1/broadcasts/route.ts:80`).
  - Reanudar un broadcast: `after()` en `src/app/api/whatsapp/broadcast/[id]/resume/route.ts:102`.
  - `conversation.created` desde la API: `src/app/api/v1/messages/route.ts:112`.
- **Endpoints cron** protegidos por `x-cron-secret` = `AUTOMATION_CRON_SECRET` (comparación con `timingSafeEqual`):
  - `GET /api/automations/cron` (`src/app/api/automations/cron/route.ts:23-78`): expira `awaiting_reply` vencidos (24 h), reencola ejecuciones atascadas (`STALLED_CLAIM_MS` de 15 min, `engine.ts:389-418`) y drena hasta 50 `automation_pending_executions` vencidas. El claim es un UPDATE por id (`claimPendingExecution`, `engine.ts:391`).
  - `GET /api/flows/cron` (`src/app/api/flows/cron/route.ts`): solo barre los `flow_runs` caducados (RPC `list_timed_out_flow_runs`, 24 h por defecto). No envía mensajes.
  - **No hay programador dentro del repo**: ni `vercel.json` ni un workflow con cron (`.github/workflows` solo tiene `ci.yml` y `migrations.yml`). `docs/docker.md:72-76` pide un pinger externo.
- **Broadcasts desde el dashboard: el bucle de envío corre en el navegador.** El hook `src/hooks/use-broadcast-sending.ts:75,497` llama a `POST /api/whatsapp/broadcast` en lotes de 10. Si se cierra la pestaña, la campaña queda a medias; `broadcast-resume.ts:1-17` existe para recuperarla.
- **Rate limit en memoria** (`src/lib/rate-limit.ts:2-12`): no sirve con más de una instancia. Afecta a `ai-autoreply:{account}` (`ai/auto-reply.ts:104`) y a los envíos.
- **Webhooks salientes**: un solo intento, timeout de 5 s, sin reintentos ni cola (`src/lib/webhooks/deliver.ts:11-18,31`).

---

## 2. Módulo por módulo: propósito, disparo, envío y supuestos de WhatsApp

### 2.1 Rutas de envío (resumen)

| Ruta | Archivo | Tipos | Persiste en `messages` | Usado por |
|---|---|---|---|---|
| A. Núcleo de envío compartido | `src/lib/whatsapp/send-message.ts:189` (`sendMessageToConversation`) | text, template, media, interactive | Sí (`:300`, `:481`) | Composer del inbox (`api/whatsapp/send/route.ts`) y `POST /api/v1/messages` |
| B. Envío desde automatizaciones | `src/lib/automations/meta-send.ts:116` (`sendViaMeta`) | text, template (los interactivos se delegan a C) | Sí, `sender_type='bot'` (`:236-245`) | Motor de automatizaciones |
| C. Envío desde flows | `src/lib/flows/meta-send.ts:92,206,339,349,359` | text, media, buttons, list | Sí, `sender_type='bot'` (`:158-160`, `:280`) | Flows, automatizaciones (interactivos), auto-respuesta de IA (`engineSendText` con `aiGenerated`) |
| D. Broadcast | `src/lib/whatsapp/broadcast-core.ts:266` y `src/app/api/whatsapp/broadcast/route.ts` | solo template | **No.** Solo `broadcast_recipients`; el envío no aparece en el inbox | API v1, dashboard, resume |

Comentario explícito de deuda en `automations/meta-send.ts:25-33`: "Mirrors the logic in src/app/api/whatsapp/send/route.ts … they can converge in a later refactor". B y C repiten la misma secuencia: leer contacto, `resolveContactSendTarget`, leer `whatsapp_config` `.single()`, `decrypt`, reintento con `phoneVariants` + `isRecipientNotAllowedError`, insertar en `messages` con `message_id = wamid` y actualizar la vista previa de la conversación.

### 2.2 Automatizaciones (`src/lib/automations`, `src/app/api/automations`)

- **Propósito**: reglas *trigger → pasos* (lineales con ramas `condition`/`wait`), guardadas en `automations` y `automation_steps` (migraciones 006, 045, 051, 058).
- **Disparo**:
  - Webhook de Meta, por cada mensaje entrante: `new_contact_created`, `first_inbound_message`, `new_message_received`, `keyword_match`, `interactive_reply` (`webhook/route.ts:854-900`). Los triggers de contenido se suprimen si un flow o una automatización en espera consumió el mensaje (`:838-866`).
  - `tag_added`: desde `add_tag` (`engine.ts:810-845`) y `src/lib/contacts/tag-events.ts:52`.
  - Manual o externo: `POST /api/automations/engine` (`src/app/api/automations/engine/route.ts:12-41`, rol `agent`).
  - **`conversation_assigned` y `time_based` están definidos en los tipos y en la UI (`src/types/index.ts:486-488`, `automation-builder.tsx:163`), pero ningún código los despacha.** Son triggers muertos.
  - Reanudación: el cron (pasos `wait`) y `resumeAwaitingReply` en el webhook (`engine.ts:236`), que busca por `(account_id, contact_id, status='awaiting_reply')`.
- **Envío**: `send_message` → `engineSendText`, `send_template` → `engineSendTemplate`, `send_buttons`/`send_list` → `engineSendInteractive` → ruta C (`engine.ts:739-808`; `meta-send.ts:86-112`).
- **Supuestos de WhatsApp**:
  - `REPLY_WAIT_MS = 24h`, "WhatsApp's 24h service window" (`engine.ts:214-215`), con su expiración en el cron.
  - Plantillas Meta con parámetros posicionales `{{1}}…` (`engine.ts:780-797`).
  - Límites de interactivos de Meta (`validateInteractivePayload`, `src/lib/whatsapp/interactive.ts:112-220`).
  - Los logs del paso guardan `"sent via Meta (wamid)"` (`engine.ts:752,772,807`).
  - `resolveConversationId` supone una sola conversación por contacto (`engine.ts:1016-1045`). `assign_conversation` y `close_conversation` actualizan **todas** las conversaciones del contacto (`engine.ts:876-880,991-995`).
  - `update_contact_field` solo permite `name`, `email` y `company` (`engine.ts:921`).
- **Veredicto**: debe ser **agnóstica de canal** (sección 5). Los pasos `send_template`, `send_buttons` y `send_list` necesitan un "fallback por canal" o validación según capacidades.

### 2.3 Flows (`src/lib/flows`, `src/app/api/flows`)

- **Propósito**: chatbot de grafo (nodos `start`, `send_message`, `send_buttons`, `send_list`, `send_media`, `collect_input`, `condition`, `set_tag`, `handoff`, `end`; `src/lib/flows/types.ts:188-197`). Tablas `flows`, `flow_nodes`, `flow_runs` y `flow_run_events` (migraciones 010, 016, 052).
- **Disparo**: solo desde el webhook de Meta, mediante `dispatchInboundToFlows` (`engine.ts:988`; llamada en `webhook/route.ts:801-821`). Tiene prioridad sobre automatizaciones e IA (`consumed`). El cron solo cierra runs caducados.
- **Concurrencia**:
  - Idempotencia por `meta_message_id` (`engine.ts:24-26,325`).
  - Índice único parcial `idx_one_active_run_per_contact` sobre `flow_runs(user_id, contact_id) WHERE status='active'` (`010_flows.sql:186-190`). Un contacto tiene a lo sumo un run activo, **sin importar el canal**.
- **Envío**: ruta C (`flows/meta-send.ts`). `loadAccountMetaCredentials` (`:44-60`) es el "único hogar" del decrypt y también lo usa la IA.
- **Supuestos de WhatsApp**:
  - Los nodos de botones y listas **son** mensajes interactivos de Meta: ≤3 botones, ≤20 caracteres, ≤10 filas, ≤24 caracteres (`flows/validate.ts:15-16,117,384`).
  - `ParsedInbound` lleva `meta_message_id` (`webhook/route.ts:808-819`).
  - El handoff pone `conversations.status='pending'` (`engine.ts:495-517`).
- **Veredicto**: para el MVP puede quedarse en **WhatsApp (Cloud y WAHA)**. WAHA no soporta de forma fiable botones y listas nativos, así que hace falta un "render de fallback" como texto numerado ("responde 1, 2 o 3") y un mapeo de la respuesta numérica a `reply_id`. Para email no tiene sentido en el MVP.

### 2.4 IA (`src/lib/ai`, `src/app/api/ai`)

- **Propósito**: auto-respuesta con BYO key (Anthropic, OpenAI u OpenAI-compatible; `src/lib/ai/providers/*`), base de conocimiento con embeddings (030), borrador para agentes (`api/ai/draft`), playground y métricas de uso (029, 033, 046, 053).
- **Disparo**: `dispatchInboundToAiReply` desde el webhook (`webhook/route.ts:904-916`), solo si nadie consumió el mensaje, no es interactivo y tiene texto. El borrador es bajo demanda y no envía nada (`api/ai/draft/route.ts:21-24`).
- **Puertas de elegibilidad** (`ai/auto-reply.ts:46-206`):
  - Se retira si existe **cualquier** automatización activa `new_message_received` o `keyword_match` (`:73-81`).
  - No responde si hay un agente asignado, si la auto-respuesta está desactivada o si se alcanzó el tope `claim_ai_reply_slot` (RPC atómica).
- **Envío**: `engineSendText(..., aiGenerated: true)` → ruta C (`auto-reply.ts:208-215`). Antes muestra el indicador de escritura con `sendTypingIndicator` de Meta, usando el wamid entrante (`:113-115,247-266`).
- **Supuestos de WhatsApp**:
  - El comentario "The 24h WhatsApp session window is inherently open here" (`:42-44`) **no vale para email** y solo a medias para WAHA.
  - El prompt del sistema dice literalmente "WhatsApp CRM … suitable for WhatsApp" (`src/lib/ai/defaults.ts:61-64`). Respuestas cortas, `MAX_OUTPUT_TOKENS` (`:26-28`).
  - `hasNewerInbound` compara `messages.message_id` (wamid) (`:226-240`).
  - El contexto solo toma `content_type='text'` (`src/lib/ai/context.ts:24-29`). Un email (HTML, asunto, hilos citados) necesitará normalización.
- **Veredicto**: **agnóstica de canal** (el valor para una inmobiliaria está en email y WhatsApp por igual). Cambios necesarios: prompt parametrizado por canal (tono y longitud; email con asunto y firma), typing indicator opcional según capacidad, envío vía `ChannelSender` y "respuesta en hilo" para email.

### 2.5 Broadcasts (`src/lib/broadcast-*.ts`, `src/lib/whatsapp/broadcast-*`, `src/app/api/whatsapp/broadcast`, `src/app/api/v1/broadcasts`)

- **Propósito**: campañas de **plantillas Meta** a audiencias (por tags, campo custom, CSV o todos; `src/lib/broadcast-audience.ts:14-47`). CSV con columna `phone` obligatoria (`src/lib/broadcast-csv.ts:26-33`).
- **Disparo**:
  - Dashboard: bucle en el navegador, en lotes de 10 (`use-broadcast-sending.ts:497`).
  - API: `createBroadcast` y luego `after(deliverBroadcast)` (`broadcast-core.ts:88,266`; `v1/broadcasts/route.ts:64-80`).
  - Reanudar: `broadcast-resume.ts:63-280`, con un lease (`broadcast-delivery-lease.ts`, migración 038).
- **Envío**: `sendTemplateMessage` de Meta directamente (`broadcast-core.ts:276-286`; `api/whatsapp/broadcast/route.ts:130-140`), con reintento de variantes de teléfono. **No crea filas en `messages` ni conversaciones**: el contacto no ve la plantilla en su hilo del inbox.
- **Estados**: dependen al 100 % del wamid.
  - `broadcast_recipients.whatsapp_message_id` (003).
  - `applyBroadcastRecipientStatus` desde el webhook de estados (`webhook/route.ts:455-464`; `broadcast-recipient-webhook.ts:29`).
  - Contadores mantenidos por trigger (005).
  - `replied`: si responde en 7 días (`BROADCAST_REPLY_WINDOW_MS`, `broadcast-recipient-webhook.ts:5,63-73`).
- **Veredicto**: **puede quedarse solo para WhatsApp Cloud en el MVP**. Hay que añadir `channel_id` (qué número envía) en `broadcasts`; hoy usa "el" número de la cuenta. Campañas por email (Mailgun) y WAHA (riesgo de bloqueo con envíos masivos no oficiales) van **fuera del MVP**.

### 2.6 Webhooks salientes (`src/lib/webhooks`)

- **Propósito**: endpoints suscritos por cuenta (`webhook_endpoints`, 028/054), firma HMAC (`sign.ts`), protección SSRF (`ssrf.ts`) y auto-desactivación tras 15 fallos (`deliver.ts:34`).
- **Eventos** (`events.ts:10-14`): `message.received`, `message.status_updated` y `conversation.created`.
- **Sobre** (`deliver.ts:66-72`): `{ id, event, occurred_at, account_id, data }`. Cabeceras `X-Wacrm-Event`, `X-Wacrm-Webhook-Id` y `X-Wacrm-Signature` (`:118-120`).
- **Payloads actuales**:
  - `message.received` (`webhook/route.ts:926-932`): `{ conversation_id, contact_id, whatsapp_message_id, content_type, text }`.
  - `message.status_updated` (`:470-479`): `{ whatsapp_message_id, conversation_id, status }`.
  - `conversation.created` (`:632-635`; `v1/messages/route.ts:113-116`): `{ conversation_id, contact_id }`.
- Los emisores viven **solo** en el webhook de Meta y en la API v1. Los envíos de automatizaciones, flows y la IA no emiten `message.sent`.

### 2.7 API pública v1 (`src/lib/api`, `src/app/api/v1`) y api-keys (`src/lib/api-keys`)

- **Auth**: API key con scopes (`scopes.ts:1-9`): `messages:send`, `messages:read`, `contacts:read`, `contacts:write`, `conversations:read`, `broadcasts:send` y `webhooks:manage`. La descripción dice "Send WhatsApp messages" (`:13`).
- **`POST /api/v1/messages`** (`v1/messages/route.ts`):
  - El destino es `to` en E.164. Se resuelve con `resolveConversationByPhone` (`src/lib/whatsapp/resolve-conversation.ts:42-108`), que rechaza lo que no sea teléfono internacional (`:51-55`).
  - Respuesta: `whatsapp_message_id`.
- **Contactos**:
  - `findOrCreateContact` exige `phone` (`src/lib/api/v1/contacts.ts:110-138`).
  - `ApiContact` expone `phone` y `email` (`:20-24`), pero no `wa_user_id` ni otras identidades.
- **Conversaciones y mensajes** (`src/lib/api/v1/conversations.ts:13-100`):
  - `ApiConversation` no tiene canal y su `contact` está centrado en `phone`.
  - `ApiMessage.whatsapp_message_id` mapea `messages.message_id` (`:94`).
  - `direction` se deriva de `sender_type` (`:88`).
- **Broadcasts**: `POST /api/v1/broadcasts` con `{ template_name, template_language, recipients:[{to, params}] }`.

### 2.8 MCP server (`mcp-server/`)

- Wrapper fino sobre `/api/v1` (`mcp-server/src/client.ts:44`).
- Herramientas con semántica de WhatsApp en el texto:
  - `send_message`: "Send WhatsApp message … E.164 … 24-hour customer-service window … template required to open a new conversation" (`mcp-server/src/tools/write.ts:27-55`).
  - Crear contacto por teléfono (`:60-67`).
  - Broadcast de plantilla (`tools/broadcast.ts:18-31`).
  - Búsqueda de contactos "name or phone" (`tools/read.ts:35-37`).
- Cambiarlo cuesta poco (solo descripciones y esquemas zod), pero va **después** de la API v1. Es un consumidor.

### 2.9 Dashboard (`src/lib/dashboard`, migración 059)

- `loadOverview` → RPC `dashboard_overview` (`src/lib/dashboard/overview.ts:176-181`). Actividad en `queries.ts:8-40` (mensajes, contactos con `phone`).
- **Supuestos de WhatsApp** en el SQL (`059_dashboard_overview.sql`):
  - `windowsClosing` y `windowClosesAt = last_inbound_at + 24h` (`:262-289`).
  - KPIs `broadcastDelivered/Read` (`:495-512`).
  - Plantillas aprobadas o rechazadas (`:603-607`).
  - Checklist de configuración `whatsapp_config.status='connected'` (`:614-618`).
- Lo agnóstico, que se reaprovecha: tiempos de primera respuesta humana y de IA, cola sin asignar, mensajes fallidos y volumen (`:44-114,234-337`). Se basan en `messages.sender_type/status/ai_generated` y `conversations.last_inbound_at`.
- **Veredicto**: las métricas deben volverse **agnósticas y filtrables por canal y equipo**. La "ventana 24 h" solo aplica a conversaciones de WhatsApp Cloud.

### 2.10 Media y storage (`src/lib/media`, `src/lib/storage`)

- **Entrante**: `messages.media_url` guarda `/api/whatsapp/media/<mediaId>` (un proxy autenticado contra Meta) o, si está activo el mirror (039), una URL pública del bucket `chat-media` (`src/lib/whatsapp/mirror-inbound-media.ts:6-39`; `src/lib/media/blob-cache.ts:6-25`).
- **Saliente**: `uploadMedia` a `<bucket>/account-<id>/...` (`src/lib/storage/upload-media.ts:7-20`), con límite de 16 MB.
- **Supuestos de WhatsApp**: el prefijo del proxy está fijo en el código (`blob-cache.ts:25`) y el nombre sintético es `whatsapp-<kind>-<ts>` (`filename.ts:178`).
- **Veredicto**: el bucket `chat-media` ya es agnóstico. Conviene que **todos los canales hagan mirror al bucket** (WAHA entrega URLs temporales; Mailgun, adjuntos), que el proxy de Meta quede como caso particular de Cloud API y que se use `media_url` siempre como URL del bucket.

---

## 3. Modelo de contactos e identidad

**Estado actual**

- `contacts.phone TEXT NOT NULL` y `email TEXT` nullable, sin índice (`001_initial_schema.sql:39,41`).
- **022**: columna generada `phone_normalized = regexp_replace(phone,'\D','','g')`, función `merge_duplicate_contacts()` que re-apunta los hijos al más antiguo, e índice `UNIQUE(account_id, phone_normalized) WHERE phone_normalized <> ''` (`022:30-32,38-57,118-120`).
- **036**: merge de conversaciones duplicadas e índice `UNIQUE(account_id, contact_id)` en `conversations` (`036:1-35`). Así se formaliza "1 contacto = 1 conversación".
- **040**: `wa_user_id` (BSUID), `wa_parent_user_id` y `wa_username`, con `UNIQUE(account_id, wa_user_id) WHERE NOT NULL`. Un contacto solo con BSUID guarda `phone=''` (`040:1-45`).
- **Lógica en la app**:
  - `findExistingContact` busca `phone_normalized IN phoneVariants(...)` y `pickBestPhoneMatch` aplica tolerancia al prefijo troncal (`src/lib/contacts/dedupe.ts`).
  - El webhook intenta primero el BSUID y luego el teléfono, y rellena el BSUID que falte (`webhook/route.ts:1223-1240`; `wa-identity.ts:1-30`).
  - `resolveContactSendTarget` usa el teléfono E.164 o, si no hay, el BSUID (`wa-identity.ts:186-199`).
- La identidad también está **implícita** en la tabla `broadcast_recipients.contact_id NOT NULL` y en los runs de flows/automatizaciones por `contact_id`.

**Problemas para Conexa**

1. El email no es identidad. No hay dedup ni índice, y la API no permite crear un contacto sin teléfono.
2. WAHA identifica por `chatId` (`5215512345678@c.us`, o `@lid` para IDs ocultos y `@g.us` para grupos). Parte del caso `@c.us` cae en `phone_normalized`, pero `@lid` no.
3. Varios números Cloud API en la misma cuenta comparten el contacto (bien), pero el **BSUID es por portfolio**: si dos números pertenecen a portfolios distintos, el mismo cliente tiene dos BSUID diferentes. El índice único de 040 lo tolera (distintos valores), aunque el contacto solo guarda uno.
4. Una persona puede escribir por WhatsApp y por email. Hoy serían dos contactos sin vínculo.

**Propuesta (pragmática)**

```sql
CREATE TABLE contact_identities (
  id uuid PK, account_id uuid NOT NULL, contact_id uuid NOT NULL REFERENCES contacts ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('phone','wa_bsuid','email','waha_chat','sip')),
  value text NOT NULL,            -- normalizado: dígitos, lower(email), chatId completo
  channel_id uuid NULL,           -- p. ej. BSUID depende del portfolio/numero; email no
  is_primary bool DEFAULT false, verified_at timestamptz, created_at timestamptz DEFAULT now(),
  UNIQUE (account_id, kind, value)
);
```

- Backfill desde `contacts.phone_normalized`, `wa_user_id` y `email`. Mantener `contacts.phone` y `email` como **columnas de presentación** (el contacto "principal"); `phone` pasa a NULLable o se queda en `''` (la 040 ya usa `''`).
- Sustituir `findExistingContact`, `findContactByWaUserId` y `resolveConversationByPhone` por un único `resolveContactByIdentity(accountId, {kind, value})`, con la misma tolerancia de variantes para `phone`.
- La dedup entre identidades (por ejemplo, el mismo teléfono en WAHA y en Cloud) sale gratis si WAHA `@c.us` se normaliza a `kind='phone'`. `@lid` se guarda como `waha_chat`.
- Merge manual de contactos: generalizar `merge_duplicate_contacts()` (022) a `merge_contacts(survivor, loser)`.

---

## 4. Eventos salientes, API pública y MCP: dónde falta `channel`

| Superficie | Forma actual | Cambio propuesto |
|---|---|---|
| Sobre del webhook | `{id,event,occurred_at,account_id,data}` (`deliver.ts:66-72`) | Añadir `channel: {id, type:'whatsapp_cloud'\|'whatsapp_waha'\|'email'}` en `data` o en el sobre. Renombrar las cabeceras `X-Wacrm-*` a `X-Conexa-*` y mantener alias. |
| `message.received` | `whatsapp_message_id`, `content_type`, `text` | `message_id` (interno), `external_id` (wamid, id de WAHA o Message-Id de Mailgun), `channel`, `direction`, `subject?` (email), `from_identity {kind,value}`. Mantener `whatsapp_message_id` como deprecated. |
| `message.status_updated` | `whatsapp_message_id`, `status` | `external_id` y `channel`. El email tiene otros estados (`delivered`, `opened`, `failed`, `bounced`, `complained` en Mailgun); hay que mapearlos al enum o ampliar el CHECK de `messages.status` (`001:171`). |
| `conversation.created` | `conversation_id`, `contact_id` | `channel` e `inbox_id`/`team_id`. |
| Nuevos eventos | — | `message.sent` (hoy faltan envíos de bots e IA), `conversation.assigned` y, más adelante, `ticket.*` y `call.*`. |
| `POST /api/v1/messages` | `to` (E.164) y `type`; responde `whatsapp_message_id` | Aceptar `channel_id` (opcional; por defecto, el canal predeterminado de la cuenta) y `to` como `{phone\|email\|contact_id}`; añadir `subject` para email. Respuesta: `external_id` y `channel`. |
| `ApiContact` | `phone`, `email` | `identities: [{kind,value,channel_id}]`. `phone` deja de ser obligatorio en create si viene `email`. |
| `ApiConversation` / `ApiMessage` | sin canal; `whatsapp_message_id` | `channel_id`, `channel_type`, `external_id` y `subject`. |
| Scopes | descripciones "WhatsApp" (`scopes.ts:13`) | Mantener nombres y ajustar descripciones. Más adelante: `tickets:*`, `calls:read`. |
| MCP | `send_message` con E.164 y la ventana de 24 h en el texto (`write.ts:32-34`) | Parámetro `channel` y `to` polimórfico. Describir reglas por canal (solo Cloud tiene ventana y plantillas). |

---

## 5. Clasificación para el MVP

| Módulo | MVP | Motivo |
|---|---|---|
| Broadcasts (plantillas) | **Solo WhatsApp Cloud.** Añadir `channel_id` para elegir el número. | Las plantillas y estados son de Meta; con WAHA hay riesgo de baneo; email masivo va en otra fase. |
| Plantillas (`message_templates`) | Solo Cloud, **por número/WABA** | Se aprueban por WABA. Hoy son únicas por cuenta (057). |
| Flows | WhatsApp (Cloud y WAHA con fallback de texto). Email fuera. | Interactivos de Meta; un run por contacto. |
| Automatizaciones | **Agnósticas** | Los triggers (`new_message_received`, `keyword_match`, `first_inbound_message`, `tag_added`) son de negocio. Añadir condición o filtro `channel`. |
| IA auto-reply y borrador | **Agnósticas** | Mismo LLM; el prompt y el envío dependen del canal. |
| Webhooks salientes, API v1 y MCP | **Agnósticos (campo `channel`)** | Contrato externo; mejor romperlo una sola vez, al principio. |
| Dashboard | **Agnóstico y filtrable por canal y equipo** | KPI de tiempos de respuesta y cola; la ventana de 24 h solo para Cloud. |
| Media/storage | **Agnóstico** (mirror universal a `chat-media`) | Ya está casi listo. |
| Contactos | **Agnóstico (multi-identidad)** | Requisito para unificar la bandeja. |

---

## 6. Recomendaciones de refactor (en orden)

1. **Modelo `channels` antes que nada.**
   - Tabla `channels(id, account_id, type, name, config jsonb cifrado, status, team_id?)`. Migrar `whatsapp_config` a `channels(type='whatsapp_cloud')`, o mantenerla como detalle 1:1 con `channel_id`.
   - Eliminar `whatsapp_config_account_id_key` (017:326) y conservar `UNIQUE(phone_number_id)` (013).
   - Resolver el ruteo de webhooks entrantes por `phone_number_id` → `channel_id` (hoy `webhook/route.ts:347-375`).
2. **Decidir la cardinalidad de las conversaciones (H2).** Recomendación: conversación por `(account_id, contact_id, channel_id)`, cambiando el índice de 036. Así cada número o buzón tiene su hilo y se puede responder por el mismo canal. La vista "unificada" agrupa por contacto en la UI. Implicaciones:
   - `automations/engine.ts:1033-1038` y `flows` deben usar el `conversation_id` del contexto y no "la del contacto".
   - `assign_conversation` y `close_conversation` (`engine.ts:876-880,991-995`) deben filtrar por `conversation_id`.
   - `idx_one_active_run_per_contact` (010) pasa a `(contact_id, channel_id)` o a `conversation_id`.
3. **`ChannelSender` único** (`src/lib/channels/send.ts`), por ejemplo `send({accountId, conversationId, payload: Text|Media|Template|Interactive|Email})`:
   - Resuelve el canal desde la conversación, la identidad de destino según el tipo de canal, el adaptador (`cloud` con el `meta-api.ts` actual, `waha` y `mailgun`), la inserción en `messages` (`external_id`, `channel_id`, `sender_type`, `ai_generated`), la vista previa de la conversación y el evento `message.sent`.
   - Absorbe las rutas A, B y C. `automations/meta-send.ts` y `flows/meta-send.ts` quedan como fachadas o se eliminan.
   - Las **capacidades** por adaptador (`supportsTemplates`, `supportsInteractive`, `hasServiceWindow`, `supportsTyping`, `supportsReactions`) permiten degradar: interactivo → texto numerado en WAHA, plantilla → error claro fuera de Cloud.
4. **`messages`: columnas agnósticas.**
   - Añadir `channel_id`, `external_id` (renombrar o duplicar `message_id`; el índice de idempotencia de 037 pasa a `(conversation_id, external_id)`), `subject`, `email_headers jsonb` (Message-Id, In-Reply-To y References para hilos) y `direction`.
   - Ampliar el CHECK de `content_type` (`001:168`; ya se amplió para interactive en 035) con `email`, y el de `status`.
5. **Extraer el pipeline post-ingesta** de `webhook/route.ts:579-933` a `src/lib/inbound/process.ts`:
   - `onInboundMessage({channel, contact, conversation, message, isFirstInbound, interactiveReplyId})` → flows → `resumeAwaitingReply` → automatizaciones → IA → `dispatchWebhookEvent`.
   - Los tres webhooks entrantes (Meta, WAHA y Mailgun) se reducen a: parsear, resolver identidad y canal, persistir y llamar a `onInboundMessage`.
   - La lógica de `flagBroadcastReplyIfAny` (`:490`) solo aplica a Cloud.
6. **Identidades de contacto**: tabla `contact_identities` y `resolveContactByIdentity` (§3). Adaptar `resolve-conversation.ts`, `api/v1/contacts.ts:110-138`, la importación CSV (`dedupeByPhone`) y la audiencia de broadcasts (que sigue con `phone` para Cloud).
7. **Automatizaciones**:
   - Añadir `trigger_config.channel_types/channel_ids` (filtro) y la condición `channel`.
   - Hacer `REPLY_WAIT_MS` dependiente del canal: 24 h en Cloud, configurable en el resto.
   - Validar en `validate.ts` que `send_template`, `send_buttons` y `send_list` solo se usan con canales compatibles, o que el adaptador degrade.
   - Despachar o eliminar los triggers muertos `conversation_assigned` y `time_based`.
8. **IA**:
   - `buildSystemPrompt({..., channel})` con variantes de WhatsApp y email (`defaults.ts:61-64`).
   - `buildConversationContext` debe incluir `email` (texto plano extraído, sin citas).
   - Typing indicator solo si `supportsTyping`.
   - La puerta "hay automatizaciones de respuesta activas" (`auto-reply.ts:73-81`) debería considerar el filtro de canal.
9. **Background jobs**:
   - Tabla `jobs` (o `pgmq`) y un worker en un proceso Node aparte (Docker), o pg_cron que llame a los endpoints existentes.
   - Mover ahí el bucle de envío de broadcasts del dashboard (hoy en el navegador), los reintentos de webhooks salientes, el envío de email (Mailgun tolera bien los reintentos) y la sincronización de WAHA.
   - Mientras tanto, documentar y automatizar el pinger de `/api/automations/cron` y `/api/flows/cron`.
   - Rate limit a Redis o Postgres si hay más de una instancia (`rate-limit.ts:9-12`).
10. **Contrato externo** (§4): introducir `channel` y `external_id` en webhooks, API v1 y MCP de una sola vez. Mantener `whatsapp_message_id` como alias durante una versión.
11. **Dashboard**:
    - `dashboard_overview(p_days, p_tz, p_channel_ids?, p_team_id?)`.
    - `windowsClosing` solo con `channel.type='whatsapp_cloud'`.
    - El checklist de configuración pasa de "whatsapp_config conectado" a "≥1 canal conectado".
12. **Media**: mirror obligatorio al bucket en todos los canales. El proxy `/api/whatsapp/media/<id>` queda solo como fallback de Cloud. Renombrar el nombre sintético `whatsapp-*` (`filename.ts:178`) por canal.

**Orden sugerido de PRs**: (1) `channels` + migración de `whatsapp_config` → (2) `channel_id` en conversations/messages y cambio del índice de 036 → (3) `ChannelSender` (solo adaptador Cloud; refactor sin cambio funcional, cubierto por los tests existentes: `send-message.test.ts`, `meta-send.test.ts`, `engine.test.ts`) → (4) `onInboundMessage` extraído → (5) `contact_identities` → (6) adaptador WAHA → (7) adaptador Mailgun → (8) contrato API/webhooks/MCP → (9) dashboard por canal → (10) worker/cola.
