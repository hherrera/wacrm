# 06 · Mejoras al código base para soportar varios canales (síntesis)

Consolida los hallazgos de [01](01-arquitectura-general.md)–[05](05-automatizaciones-flows-ia-broadcasts-api.md). Ordenado por **impacto en la extensión multicanal**, no por gravedad general.

## A. Bloqueos estructurales (deben resolverse antes de cualquier canal nuevo)

| # | Problema | Evidencia | Mejora propuesta |
|---|---|---|---|
| A1 | No existe el concepto de **canal** | `conversations` sin `channel_id`; `whatsapp_config` es "la" configuración | Tabla `channels (id, account_id, type, name, status, config jsonb, ...)`; `whatsapp_config` pasa a ser detalle 1:1 de un canal `whatsapp_cloud` (FK `channel_id`). |
| A2 | 1 número WA por cuenta | `whatsapp_config_account_id_key` (017:319) + 7 lecturas `.eq('account_id').single()` en rutas de envío | Quitar UNIQUE; resolver config **por `conversation.channel_id`**, nunca por cuenta. |
| A3 | 1 conversación por contacto | `idx_conversations_account_contact` (036:125); `findOrCreateConversation` duplicado (webhook:1320 y `resolve-conversation.ts`) | UNIQUE `(channel_id, contact_id, thread_key)` con `thread_key=''` en canales de chat y raíz del hilo en email. Una sola función `findOrCreateConversation` en `lib/inbox`. |
| A4 | Identidad = teléfono | `contacts.phone NOT NULL`, dedupe por `phone_normalized`/`wa_user_id` | `contact_identities (account_id, contact_id, kind, value, value_normalized)` UNIQUE `(account_id, kind, value_normalized)`; `kind ∈ phone, wa_bsuid, waha_lid, email`. `phone` nullable; se mantiene como columna "principal" para no romper UI/API. |
| A5 | Pipeline entrante incrustado en la ruta Meta | `webhook/route.ts:579-933` | Extraer `lib/inbox/ingest.ts::ingestInbound(InboundEvent)`; los webhooks de Meta/WAHA/Mailgun sólo verifican firma, parsean a `InboundEvent` y llaman. Mismo para estados: `ingestStatus(StatusEvent)`. |
| A6 | 4–5 caminos de envío a Meta | `send-message.ts`, `automations/meta-send.ts`, `flows/meta-send.ts` (+IA), `broadcast-core.ts`, `api/whatsapp/react` | Un único `lib/inbox/outbound.ts::sendToConversation()` que valida contra capacidades del canal, delega al **adaptador** y persiste. Motores e IA lo llaman. Broadcasts pueden seguir llamando a Meta directo pero vía el adaptador de canal. |

## B. Contrato de adaptador de canal

Tres implementaciones reales en el MVP (Cloud, WAHA, Mailgun) justifican una interfaz:

```ts
// lib/channels/types.ts
export type ChannelType = 'whatsapp_cloud' | 'whatsapp_waha' | 'email_mailgun' // luego: 'voice_freepbx'

export interface ChannelCapabilities {
  templates: boolean          // plantillas Meta
  interactive: boolean        // botones/listas
  reactions: boolean
  replyWindowHours: number | null   // 24 en Cloud, null en WAHA/email
  subject: boolean; html: boolean; cc: boolean
  maxAttachments: number; maxMediaBytes: number
  voiceNotes: boolean; typing: boolean; readReceipts: boolean
}

export interface ChannelAdapter {
  type: ChannelType
  capabilities: ChannelCapabilities
  send(ctx: SendContext, msg: OutboundMessage): Promise<{ externalId: string; threadRef?: string }>
  markRead?(ctx: SendContext, externalIds: string[]): Promise<void>
  react?(ctx: SendContext, externalId: string, emoji: string): Promise<void>
}
// Registro: un objeto literal { whatsapp_cloud, whatsapp_waha, email_mailgun } — sin factory.
```

Los webhooks entrantes **no** forman parte de la interfaz: cada canal tiene su ruta (`/api/channels/waha/webhook`, `/api/channels/mailgun/inbound`, `/api/channels/mailgun/events`, y se conserva `/api/whatsapp/webhook`) porque la verificación de firma y el formato difieren por completo. Todas terminan en `ingestInbound/ingestStatus`.

## C. Inbox / UI

| # | Problema | Mejora |
|---|---|---|
| C1 | Composer asume WhatsApp (24h, plantillas, voz Opus, límites Meta) — 25 puntos listados en [04](04-inbox-tiempo-real-asignacion.md) | Composer conducido por `capabilities` del canal de la conversación; composer de email separado (asunto, CC, HTML simple, adjuntos). |
| C2 | Lista sin paginación (corte silencioso ~1000) | Paginación por cursor `last_message_at` + filtros en servidor (canal, equipo, estado, asignado). |
| C3 | Escrituras directas desde el navegador (estado, asignación, unread) | `PATCH /api/conversations/:id` con auditoría (`conversation_events`) — base para SLA/tickets. |
| C4 | Unread global por conversación | `conversation_reads (conversation_id, user_id, last_read_at)`; mantener `unread_count` como contador de "nadie lo ha atendido". |
| C5 | Ventana 24h sólo en cliente | Validar en servidor dentro de `sendToConversation` cuando `capabilities.replyWindowHours`. |
| C6 | Notas internas en contacto, no en conversación | `messages.content_type='note'` (`sender_type='agent'`, nunca se envía). |
| C7 | Icono/etiqueta de canal ausente | Badge de canal en lista e hilo; filtro por canal. |

## D. Seguridad y permisos (detalle en [03](03-cuentas-roles-seguridad.md))

| # | Problema | Mejora |
|---|---|---|
| D1 | Agent ve todo; no hay equipos | `teams`, `team_members`, `channel_access (channel_id, team_id \| user_id)`; función `can_see_conversation()` en RLS; Realtime hereda RLS. |
| D2 | Secretos cifrados legibles por cualquier miembro (viewer incluido) | Credenciales de canal en `channel_secrets` sin políticas de SELECT para `authenticated`; sólo service role. |
| D3 | RLS por fila costosa (`is_account_member` por fila, join en `messages`) | `(select fn())` en políticas, desnormalizar `account_id`/`channel_id` en `messages`, índices. |
| D4 | Rate limit en memoria | Aceptable con una instancia (MVP). Documentar; mover a Postgres/Redis si se escala. |
| D5 | Middleware deprecado (`middleware.ts` → `proxy.ts` en Next 16) | Migrar cuando se toque. |

## E. Procesamiento asíncrono

| # | Problema | Mejora (MVP → futuro) |
|---|---|---|
| E1 | Sin cola; envíos fallidos no se reintentan; webhooks salientes un intento | MVP: tabla `outbound_jobs` / reutilizar patrón lease de broadcasts + cron `/api/jobs/cron` cada minuto. Futuro: worker dedicado (pg-boss o similar) cuando entren FreePBX/transcripciones. |
| E2 | Tareas periódicas nuevas: salud de sesiones WAHA, reconciliación Events API Mailgun | Endpoints cron con el mismo secreto que `automations/cron`. |

## F. Contrato externo
Webhooks salientes, `/api/v1` y MCP exponen `whatsapp_message_id`. Añadir `channel {id,type,name}` y `external_id`; mantener `whatsapp_message_id` como alias para no romper integraciones.

## G. Higiene recomendada (barata, no bloqueante)
- Generar tipos con `supabase gen types typescript` y derivar `types/index.ts` de ellos.
- Mover `lib/whatsapp/{send-message,resolve-conversation,message-status*,conversation-scope}` a `lib/inbox/` (son de dominio, no de Meta).
- Triggers de automatización muertos (`conversation_assigned`, `time_based`): implementarlos (útiles para enrutamiento) o quitarlos de la UI.
- Prompt de IA menciona "WhatsApp" literal → parametrizar por canal.

## H. Orden sugerido de refactor (antes de las features)
1. Migración `channels` + backfill (un canal `whatsapp_cloud` por cada `whatsapp_config`; `conversations.channel_id`, `messages.channel_id`).
2. `sendToConversation` + adaptador `whatsapp_cloud` (sin cambio funcional; tests existentes deben pasar).
3. Extraer `ingestInbound`/`ingestStatus` del webhook Meta (sin cambio funcional).
4. `contact_identities` + resolver único.
5. Recién entonces: multi-número, WAHA, equipos, Mailgun.

Cada paso es un PR independiente con la suite de Vitest (158 archivos) como red de seguridad.
