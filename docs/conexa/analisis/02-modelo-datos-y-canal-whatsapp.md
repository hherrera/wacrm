# 02 · Modelo de datos y canal WhatsApp Cloud

## 1. Tablas núcleo de mensajería (estado tras 059 migraciones)

### `contacts`
| Columna | Origen | Comentario |
|---|---|---|
| `account_id` | 017 | tenencia |
| `user_id` | 001 | autor (legado) |
| `phone TEXT NOT NULL` | 001 | `''` si sólo hay BSUID |
| `phone_normalized` (generada) | 022 | **UNIQUE (account_id, phone_normalized) WHERE <> ''** |
| `wa_user_id`, `wa_parent_user_id`, `wa_username` | 040 | BSUID de Meta (usuarios con username); UNIQUE por cuenta |
| `email`, `name`, `company`, `avatar_url` | 001 | `email` **no es identidad**: sin índice ni dedupe |

Dedupe en `lib/contacts/dedupe.ts::findExistingContact` (teléfono normalizado / BSUID) + respaldo con índice único y `isUniqueViolation` → re-resolver.

### `conversations`
`id, account_id, user_id, contact_id, status ('open'|'pending'|'closed'), assigned_agent_id, last_message_text, last_message_at, unread_count, last_inbound_at, last_reply_at, closed_at, ai_autoreply_disabled, ai_reply_count, ai_handoff_summary, ...`

**`UNIQUE (account_id, contact_id)` (migración 036)** → una sola conversación por contacto en toda la cuenta, *para siempre* (se reabre al cerrar: `lib/conversations/reopen.ts`).
**No existe columna de canal/número.**

### `messages`
`id, conversation_id, sender_type ('customer'|'agent'|'bot'), sender_id, content_type (CHECK: text,image,document,audio,video,location,template,interactive), content_text, media_url, media_type, template_name, message_id (wamid), status (sending,sent,delivered,read,failed), reply_to_message_id, interactive_reply_id, interactive_payload, ai_generated, error_code, error_title, error_details, created_at`

- `UNIQUE (conversation_id, message_id)` (037) → idempotencia de reintentos de Meta.
- No hay `direction` explícito (se infiere de `sender_type`), ni `channel_id`, ni `subject`, ni `html`, ni adjuntos múltiples (un solo `media_url`), ni `metadata jsonb` genérico.
- Reacciones en `message_reactions` (009).

### `whatsapp_config`
`account_id, user_id, phone_number_id (UNIQUE, 013), waba_id, access_token (cifrado), verify_token (cifrado), status, registered_at, subscribed_apps_at, last_registration_error, mirror_inbound_media`

**`UNIQUE (account_id)` (017)** → *un número por cuenta*. El comentario de la migración lo reconoce: "If multi-number-per-account is ever wanted, drop the unique and add a primary boolean".

### Otras dependientes de WhatsApp
`message_templates` (plantillas Meta, por cuenta, no por número/WABA), `broadcasts` + `broadcast_recipients` (`whatsapp_message_id`), `flow_runs` (único activo por contacto), `ai_usage_log`, `notifications`.

## 2. Los tres supuestos que bloquean multicanal

| # | Supuesto | Dónde está fijado | Impacto |
|---|---|---|---|
| S1 | **1 número WhatsApp por cuenta** | `whatsapp_config_account_id_key`; 38 archivos consultan `whatsapp_config ... .eq('account_id').single()` (send-message, flows/meta-send, automations/meta-send, ai/auto-reply, broadcast-core, templates, media, react, health, settings UI, inbox page) | Requisito 1 (varios números) imposible sin cambio de esquema y de todos los lectores |
| S2 | **1 conversación por contacto** | `idx_conversations_account_contact` (036); `findOrCreateConversation` duplicado en `webhook/route.ts:1320` y `lib/whatsapp/resolve-conversation.ts` | Un cliente que escribe a "Arriendos" por WA y a "Ventas" por email terminaría en un único hilo mezclado; sin canal de respuesta definido |
| S3 | **Identidad = teléfono / BSUID** | `contacts.phone NOT NULL`, dedupe por teléfono, `resolveContactSendTarget` (wa-identity) | Email entrante no puede crear contacto limpio; WAHA trae `chatId` (`57300...@c.us` o `@lid`) que hay que mapear |

## 3. Pipeline entrante (webhook) — anatomía

Archivo: `src/app/api/whatsapp/webhook/route.ts` (1.389 líneas).

| Paso | Líneas aprox. | ¿Específico de Meta? |
|---|---|---|
| GET verificación `hub.challenge` contra verify_token de cualquier config | 148–228 | Sí |
| POST: body con tope, HMAC `x-hub-signature-256`, `after()` | 230–278 | Sí (patrón reutilizable) |
| Plantillas (`message_template_status_update`…) | 315–330 | Sí |
| Estados `statuses[]` → `handleStatusUpdate` → `applyMessageStatus` + broadcasts + webhook `message.status_updated` | 333–490 | Parseo sí; aplicación de estado **genérica** |
| `phone_number_id → whatsapp_config` (cuenta, token) | 345–395 | Sí |
| `processMessage`: identidad → contacto → conversación | 579–640 | Identidad sí; resto genérico |
| Reacción | 528–577 | Mixto |
| `parseMessageContent` (descarga media de Meta, espejo a Storage) | 935–1150 | Sí |
| Mapear `type` → `content_type`, upsert idempotente | 660–745 | Casi genérico |
| `claimFirstInboundMessage`, `bump_conversation_on_inbound`, `reopenClosedConversation`, broadcast reply | 747–781 | **Genérico** |
| Flows → resume automations → triggers automations → IA auto-reply | 800–925 | **Genérico** (pero sus envíos son Meta) |
| Webhook saliente `message.received` (payload con `whatsapp_message_id`) | 926–933 | Casi genérico |

**Conclusión:** ~60% del archivo es pipeline de dominio que cualquier canal debe ejecutar. Hay que extraerlo a `lib/inbox/ingest.ts` (o `lib/channels/ingest.ts`) con una entrada normalizada; cada canal (Meta, WAHA, Mailgun) sólo parsea y llama.

## 4. Pipeline saliente

`lib/whatsapp/send-message.ts::sendMessageToConversation(db, accountId, params)` (líneas 189–551):
1. valida (`validateSendMessageParams`: tipos, caption ≤1024),
2. carga conversación+contacto (por cuenta),
3. **carga `whatsapp_config` por `account_id` con `.single()`** ← S1,
4. resuelve destino (teléfono con variantes / BSUID),
5. `attempt()` despacha a `meta-api.ts` (texto, plantilla, media, botones, lista) con reintento por variantes de teléfono,
6. inserta en `messages` (`message_id = wamid`, `status='sent'`), aplica estados pendientes,
7. actualiza preview de conversación, pausa flows activos.

Los pasos 1–2 y 6–7 son genéricos; 3–5 son del transporte. Seam natural para `adapter.send()`.

Duplicados de envío (ver [05](05-automatizaciones-flows-ia-broadcasts-api.md)): `lib/automations/meta-send.ts`, `lib/flows/meta-send.ts`, `lib/ai/auto-reply.ts`, `lib/whatsapp/broadcast-core.ts`, `api/whatsapp/react`.

## 5. Gestión de la configuración Meta
`api/whatsapp/config/route.ts` (614 líneas): guarda credenciales cifradas, verifica el número contra Graph, `POST /{id}/register` (PIN), `POST /{waba}/subscribed_apps`, explica errores Meta (`meta-error-explain.ts`). UI: `components/settings/whatsapp-config.tsx`. Docs: `docs/whatsapp-connection-troubleshooting.md`, `docs/multi-waba.md` (varios WABA/Apps por despliegue — `META_APP_SECRET` acepta lista separada por comas: ya cubre varios números de distintas Apps).

## 6. Estados de mensaje
`lib/whatsapp/message-status.ts`: orden monotónico `sending < sent < delivered < read`, `failed` terminal; `canAdvanceMessageStatus` evita retrocesos. `message-status-sync.ts` guarda estados que llegan antes que el insert y los aplica después (`applyPendingMessageStatuses`). **Reutilizable tal cual** para WAHA (`ack` 0..4) y Mailgun (`accepted/delivered/failed/opened`), con un mapeo por canal.

## 7. Media
Entrante: descarga desde Graph (`getMediaUrl`/`downloadMedia`) y espeja en bucket `chat-media` (`mirror-inbound-media.ts`, migración 039/043). Saliente: el cliente sube a Storage y se envía `link` público/firmado. WAHA entrega `media.url` propia del servidor WAHA (requiere `X-Api-Key`) y Mailgun entrega adjuntos multipart → mismo patrón de espejo a Storage.

## 8. Cambios de esquema mínimos derivados (detalle en la spec)
1. Nueva tabla `channels` (genérica) y migrar `whatsapp_config` a ser 1:1 con un canal `whatsapp_cloud` (o columnas en `channels.config` cifrado). Quitar `UNIQUE(account_id)`.
2. `conversations.channel_id NOT NULL` y cambiar unicidad a **una conversación *abierta* por (contacto, canal)** — índice parcial. *(La spec fijó otra cosa: único `(channel_id, contact_id, thread_key)`, la conversación se reabre — [spec 03 §3](../spec/03-modelo-datos.md).)*
3. `contact_identities (contact_id, kind, value_normalized)` con UNIQUE por cuenta; `contacts.phone` pasa a nullable.
4. `messages`: `channel_id` (desnormalizado), `direction`, `external_id` (renombrar/alias de `message_id`), `subject`, `body_html`, `metadata jsonb`, `message_attachments`.
