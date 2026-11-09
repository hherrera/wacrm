# 04 · Inbox, tiempo real y asignación

> Alcance: `src/app/(dashboard)/inbox/page.tsx`, `src/components/inbox/**`, `src/lib/inbox/**`, `src/lib/conversations/**`, `src/hooks/**`, `src/lib/presence.ts`, `src/components/presence/**`, `src/lib/notifications/**`, `src/app/api/v1/{conversations,messages}`, `src/app/api/quick-replies`, y el núcleo de envío `src/lib/whatsapp/send-message.ts` (lo que el composer termina llamando).
> Migraciones: 001, 009, 017, 023, 024, 027, 035, 036, 037, 055, 059.
> Fecha: 2026-11-09. Las referencias son `archivo:línea`.

## 0. Resumen ejecutivo

- El inbox es **100 % cliente**: la página (`page.tsx`, 647 líneas) consulta Supabase directamente con el cliente del navegador (RLS) para leer conversaciones, mensajes, reacciones, perfiles y plantillas. Solo **escribir mensajes/reacciones** pasa por rutas API (`/api/whatsapp/send`, `/api/whatsapp/react`). **Estado y asignación se escriben directo a la tabla** desde el navegador.
- Tiempo real = **Supabase Realtime `postgres_changes`** sin filtro sobre `messages` y `conversations` (canal `inbox-realtime`) + un canal por conversación para `message_reactions`. No hay polling; hay **resync** (refetch completo) al reconectar el WS, al volver la pestaña visible y con un botón manual.
- La lista de conversaciones **carga todas las filas sin paginar** y filtra en memoria. Con >1000 conversaciones choca con el `max-rows` de PostgREST (truncado silencioso).
- Modelo: `status ∈ {open, pending, closed}`, `assigned_agent_id` (un único usuario), `unread_count` **compartido** (no por usuario), notas **por contacto** (no por conversación), etiquetas **por contacto**. **No hay equipos, colas, canales ni visibilidad por usuario**: todo miembro ve todo.
- Restricciones de BD que bloquean multicanal: `UNIQUE(account_id, contact_id)` en `conversations` (036) y `UNIQUE(account_id)` en `whatsapp_config` (017). La conversación no tiene `channel_id`.
- El acoplamiento a WhatsApp está repartido en ~25 puntos concretos (sección 4): ruta de envío, ventana 24 h (cliente), plantillas, ticks, `wamid`, `contactHandle`, tipos de contenido, límites de Meta, Ogg/Opus, banner "WhatsApp no conectado".

---

## 1. Carga de datos y tiempo real

### 1.1 Estado de la página
`InboxPageInner` mantiene todo el estado en `useState`: `conversations`, `activeConversation`, `activeContact`, `messages` (solo los del hilo activo), `resyncToken` (`page.tsx:53-68`). No hay store global ni caché (SWR/React Query).

### 1.2 Lista de conversaciones
- Query única: `from("conversations").select(CONVERSATION_SELECT).order("last_message_at", desc)` — **sin `.limit()` ni `.range()`** (`conversation-list.tsx:107-110`). Se re-ejecuta cuando cambia `resyncToken` (`:136`).
- `CONVERSATION_SELECT = "*, contact:contacts(*, contact_tags(tags(*)))"` y `normalizeConversation` aplana las etiquetas en `contact.tags` (`lib/inbox/conversations.ts:9-43`).
- Filtros **en memoria** (`conversation-list.tsx:170-194`):
  - Pestañas `all | unread | waiting | unassigned | expiring | open | pending | closed` (`lib/inbox/inbox-filters.ts:3-12`, `applyInboxFilter :41-60`).
  - `waiting` = `last_inbound_at > last_reply_at` (`:25-29`); `expiring` = ventana de 24 h de WhatsApp cerrando en ≤2 h (`:16-17, 31-35`), con reloj que avanza cada 60 s (`conversation-list.tsx:74`).
  - `unassigned` = `status==='open' && !assigned_agent_id` (`inbox-filters.ts:55-56`). **No existe filtro "mías"** ni por canal/equipo.
  - Etiquetas (OR) y empresa (match exacto) vía `matchesContactFilters` (`lib/inbox/conversations.ts:57-71`).
  - Búsqueda libre por nombre, **teléfono** y último texto (`conversation-list.tsx:183-190`). No busca en el cuerpo de mensajes.
- Catálogo de etiquetas cargado una vez (`:140-150`); empresas derivadas de las conversaciones cargadas (`:155-162`).
- Deep link `?c=<id>` y `?filter=` (`page.tsx:51, 402-446, 597`).

### 1.3 Hilo de mensajes
- Página más reciente: `from("messages").select("*").eq("conversation_id").order(created_at desc, id desc).limit(200)` y se invierte (`message-thread.tsx:77, 363-381`).
- Paginación hacia atrás por *keyset* aproximado: `.lte("created_at", oldest.created_at)` + dedupe por id en `prependOlderMessages` (`message-thread.tsx:396-431`, `optimistic-messages.ts:108-112`). Conserva el scroll con `scrollAnchorRef` (`:420-426, 564-574`).
- `mergeFetchedPage` fusiona el refetch con mensajes temporales (optimistas) y filas más nuevas ya recibidas por realtime (`optimistic-messages.ts:81-106`).
- Reacciones: fetch completo por conversación (`message-thread.tsx:437-461`) + canal `reactions:<conversationId>` con filtro `conversation_id=eq.` para INSERT/UPDATE/DELETE (`:466-534`).
- Plantillas usadas en el hilo: se cargan las filas de `message_templates` por nombre para renderizar header/botones (`:209-236`).
- Perfiles (para el selector de asignación): `from("profiles").select("*")` — todos los miembros visibles por RLS (`:273-291`).

### 1.4 Realtime
- `useRealtime` abre **un canal** con dos suscripciones `postgres_changes` `event:"*"` sobre `public.messages` y `public.conversations`, **sin filtro** (`hooks/use-realtime.ts:47-73`). La entrega queda acotada por RLS (`messages_select`/`conversations_select` = `is_account_member`, `017_account_sharing.sql:414, 511-513`), por lo que cada cliente recibe **todo el tráfico de la cuenta**.
- Manejo en la página:
  - `INSERT` de mensaje: si es del hilo activo → `applyRealtimeInsert` (reemplaza el temp optimista con mismo contenido) (`page.tsx:227-234`, `optimistic-messages.ts:35-43`); actualiza preview/unread de la conversación en la lista o la **hidrata** con un `select` si no se conoce (`page.tsx:241-264, 138-180`).
  - `UPDATE` de mensaje → parche (ticks de estado) (`:267-272`).
  - `INSERT/UPDATE` de conversación → prepend/merge + hidratación del `contact` (los payloads realtime no traen joins) (`:286-334`). En la conversación activa se fuerza `unread_count: 0` para evitar parpadeo (`:308-316`).
  - `knownConvIdsRef` evita hidrataciones redundantes (bug histórico #105/#106, `:112-128`).
- Resync: transición desconectado→conectado (`:360-372`), `visibilitychange` (`:380-390`), botón manual (`:398-400`, `message-thread.tsx:250-256`).
- Otros canales paralelos sobre las mismas tablas: `total-unread-realtime` (punto verde del menú, `hooks/use-total-unread.ts:47-58`), `browser-notifications` (INSERT de `messages`, `hooks/use-browser-notifications.ts:122-144`), `notifications-unread-count:<account>` (`hooks/use-unread-notifications.ts:39-65`), `presence:<account>` (`hooks/use-presence.ts:83`). → **4-5 suscripciones por pestaña**, todas sin filtro por equipo/asignación.
- Publicación realtime: `messages`, `conversations` (001:413-420), `message_reactions` (009:112), `member_presence` (024:99), `notifications` (027:129, `REPLICA IDENTITY FULL`).

---

## 2. Envío desde el composer (end-to-end)

### 2.1 Cadena
`MessageComposer` (UI, 931 líneas) → callbacks de `MessageThread` (`handleSend`, `handleSendMedia`, `handleSendInteractive`, `handleSendTemplate`) → `fetch("/api/whatsapp/send")` (`message-thread.tsx:597, 661, 720, 799`) → `requireRole('agent')` + rate limit por usuario (`app/api/whatsapp/send/route.ts:39-46`) → valida (`:80-93`) → resuelve `conversation_id` o find-or-create por `contact_id` (`:99-146, 206-245`) → `sendMessageToConversation` (`lib/whatsapp/send-message.ts:189`).

Núcleo de envío (`send-message.ts`):
1. Carga conversación + contacto (`:228-237`), resuelve destino teléfono **o BSUID** (`resolveContactSendTarget`, `:247-259`).
2. Carga **la única** fila `whatsapp_config` de la cuenta (`.eq('account_id').single()`, `:262-274`) y descifra el token.
3. Resuelve `reply_to_message_id` → `messages.message_id` (wamid) del padre como `context` (`:297-320`).
4. Si es plantilla, resuelve la fila local (`resolveTemplateRow`, idioma por defecto `en_US`) (`:326-344`).
5. Envía a Meta según tipo (`attempt`, `:346-410`) reintentando **variantes de teléfono** si Meta responde "recipient not allowed"; corrige el teléfono del contacto (`:415-457`).
6. **Después** del éxito en Meta inserta `messages` con `message_id = wamid`, `status:'sent'` (`:480-509`), aplica estados pendientes (`:511`), actualiza `last_message_text/at` (`:513-525`) y pausa flows activos (`:529-548`).
- `last_reply_at` lo mantiene el trigger `track_conversation_message_times` (059:76-105), no el código.
- `/api/v1/messages` reutiliza el mismo núcleo pero resuelve la conversación **por número de teléfono** (`v1/messages/route.ts:38, 101-120`).

### 2.2 Mensajes optimistas
- `newTempMessageId()` → `temp-<ts>-<n>` (`lib/inbox/optimistic-messages.ts:3-11`); burbuja con `status:'sending'` (`message-thread.tsx:583-593`).
- Éxito: `confirmedSendUpdate` cambia a `sent` y sustituye el id por el real (`optimistic-messages.ts:45-50`, `applyMessageUpdate :52-62`); el INSERT realtime también reconcilia por contenido (`sameOutgoingContent :25-33`).
- Error: `status:'failed'` + toast (`message-thread.tsx:610-617`). No hay reintento automático ni cola.

### 2.3 Media
- Subida **desde el navegador** a Storage bucket público `chat-media` en `account-<id>/…` (`message-composer.tsx:63, 401-428`; política y MIME en `023_chat_media.sql:38-122`, 16 MB). Límites por tipo `MEDIA_MAX_BYTES_BY_KIND` "espejo de Meta" (`message-composer.tsx:402-405`, `lib/storage/upload-media.ts:32`).
- `accept` del picker replica la lista MIME de Meta (`message-composer.tsx:92-101`); caption ≤1024 (`:65-66`, validado también en servidor `send-message.ts:174-186`); audio sin caption (`message-composer.tsx:531-535`).
- Notas de voz grabadas en el navegador como **Ogg/Opus** con `opus-recorder` porque es lo que WhatsApp reproduce como nota de voz (`:194-198, 438-521`), máx. 5 min.
- Si el envío falla se borra el objeto subido (`message-thread.tsx:683, 693`).
- Media entrante: URLs `/api/whatsapp/media/*` proxificadas y cacheadas como blob (`hooks/use-media-blob-url.ts:22-25`).

### 2.4 Reacciones y respuestas
- Respuesta citada: `reply_to_message_id` (009:30-37); el servidor la traduce a `context.message_id` de Meta (`send-message.ts:297-320`).
- Reacción del negocio: optimista con `withBusinessReaction` (`lib/inbox/business-reaction.ts:37-66`) + `POST /api/whatsapp/react` (`message-thread.tsx:894-939`), que exige que el mensaje tenga `message_id` (wamid) (`app/api/whatsapp/react/route.ts:65-70`) y usa `whatsapp_config` (`:103`). Rollback al snapshot en error. Bloqueada sobre mensajes `temp-` (`message-thread.tsx:900-903`).
- Tabla `message_reactions` con `UNIQUE(message_id, actor_type, actor_id)`, `actor_type ∈ {customer, agent}` (009:42-51).

### 2.5 Plantillas
- `TemplatePicker` lista `message_templates` con `status='APPROVED'` (`template-picker.tsx:121-123`), sin filtrar por número/WABA.
- `handleSendTemplate` renderiza el cuerpo localmente, envía `template_name`, `template_language`, `template_message_params` (header/body/botones) y `template_params` legado (`message-thread.tsx:771-836`).

### 2.6 Ventana de 24 h
- Calculada **solo en cliente** a partir del último mensaje `customer` **entre los cargados** (`message-thread.tsx:293-318`), no de `last_inbound_at`. Si el último inbound es anterior a los 200 mensajes cargados, se considera "sin mensajes de cliente" → expirado.
- Efecto: deshabilita texto, media, interactivos y quick replies (`message-composer.tsx:207-208, 693-699`) y muestra aviso con atajo a plantillas (`:566-580`). Badge con horas restantes en el header (`message-thread.tsx:1040-1049`).
- **El servidor no valida la ventana**: `/api/whatsapp/send` y `/api/v1/messages` dejan que Meta rechace (error 131047).
- Existe una segunda fuente de verdad para lo mismo: filtro `expiring` sobre `last_inbound_at` (`inbox-filters.ts:31-35`) y el RPC del dashboard (059:264-289).

### 2.7 Interactivos y quick replies
- Builder de botones/lista, validado con `validateInteractivePayload` (límites de Meta) en cliente y servidor (`message-composer.tsx:327-335`, `send-message.ts:157-164`); se persiste `interactive_payload` (035) para re-renderizar.
- Quick replies: tabla `quick_replies` a nivel cuenta, `kind ∈ {text, interactive}` (048); GET/POST en `app/api/quick-replies/route.ts:14-67`; picker en `quick-reply-picker.tsx:42`. Guardar un interactivo como snippet en `message-composer.tsx:337-370`. Sin ámbito por equipo/canal.
- Borrador con IA: `POST /api/ai/draft` (`message-composer.tsx:279`).
- Permisos: `useCan("send-messages")` → viewer = solo lectura (`message-composer.tsx:205-206`); servidor `requireRole('agent')`.

---

## 3. Modelo de conversación

| Aspecto | Implementación | Referencia |
|---|---|---|
| Unicidad | **1 conversación por (cuenta, contacto)**, índice único + merge de duplicados | `036_conversation_contact_dedup.sql:125-126` |
| Estados | `open \| pending \| closed` (CHECK); `closed_at` estampado por trigger | `001:144`, `types/index.ts:169`, `059:136-138` |
| Cambio de estado | `update({status})` directo desde el navegador, sin validar error; cualquier rol ≥ agent (RLS `conversations_update`) | `message-thread.tsx:752-765`, `017:416` |
| Reapertura | Inbound sobre `closed` → `open` con guard `.eq('status','closed')` contra carreras | `lib/conversations/reopen.ts:19-45`, `webhook/route.ts:776` |
| Primer inbound | `first_inbound_at` reclamado atómicamente (`.is(null)`) para disparar una sola vez el trigger `first_inbound_message` (flows y automatizaciones) | `lib/conversations/first-inbound.ts:3-22`, `webhook/route.ts:747, 820, 878`, `054:23` |
| Tiempos | `last_inbound_at` / `last_reply_at` mantenidos por trigger en INSERT de mensajes; un `failed` recalcula `last_reply_at` | `059:76-105` |
| Asignación | `assigned_agent_id` (un usuario). Cualquier agent puede asignar a cualquier miembro o desasignar; UI con presencia | `message-thread.tsx:941-971, 1127-1190` |
| Validación de asignado | Trigger `enforce_conversation_assignee_membership`: si el asignado no es miembro, revierte al anterior o NULL; la UI detecta el rechazo comparando lo pedido vs lo guardado | `055:145-193`, `lib/inbox/assignment.ts:6-15` |
| Salida de miembro | Al quitar un miembro se desasignan sus conversaciones | `055:337-354` |
| Notificación | Trigger `notify_conversation_assigned` crea fila en `notifications` (salvo auto-asignación); único `type` = `conversation_assigned` | `027:56-118`, `055:195+` |
| IA | `ai_autoreply_disabled`, `ai_handoff_summary`; tomar el hilo puede auto-asignar | `types/index.ts:195-197`, `ai-thread-banner.tsx:70`, `message-thread.tsx:1285-1296` |
| No leídos | `unread_count` **un contador por conversación compartido**; inbound lo incrementa vía RPC atómico; abrir el hilo lo pone a 0 para **todos** | `037:75-90`, `message-thread.tsx:551-561` |
| Notas | `contact_notes` (por contacto, no por conversación; no son "notas internas" en el hilo) | `contact-sidebar.tsx:97-120` |
| Etiquetas | `contact_tags` (por contacto) | `contact-sidebar.tsx:59-60` |
| Presencia | `member_presence` + RPC `touch_presence` cada 30 s, `away` tras 5 min de inactividad, `offline` tras 75 s sin latido | `024`, `lib/presence.ts:16-26`, `presence-heartbeat.tsx:59-91` |
| Notificaciones de escritorio | Toda inserción de mensaje `customer` de la cuenta, salvo si ya está viendo ese hilo; **no filtra por asignado** | `lib/notifications/browser-notify.ts:63-82` |
| API pública | `GET /api/v1/conversations` (keyset, filtros `status`, `contact_id`), `GET /:id`, `GET /:id/messages`. **No hay PATCH** de estado/asignación | `v1/conversations/route.ts:24-59`, `[id]/messages/route.ts:19-56` |

Observaciones:
- Las escrituras de estado/asignación/unread desde el navegador no pasan por una capa de dominio: no hay auditoría (quién cerró, quién reasignó), ni eventos de webhook saliente para estos cambios, ni reglas (p. ej. "solo supervisor reasigna").
- `handleStatusChange` ignora el error del `update` (`message-thread.tsx:757-762`): la UI muestra el nuevo estado aunque RLS lo rechace.

---

## 4. Acoplamientos a WhatsApp en el inbox (inventario)

**Transporte / rutas**
1. Todo envío del inbox va a `/api/whatsapp/send` (`message-thread.tsx:597, 661, 720, 799`) y reacciones a `/api/whatsapp/react` (`:923`).
2. `sendMessageToConversation` vive en `lib/whatsapp/` y lee **una** `whatsapp_config` por cuenta (`send-message.ts:262-266`); `UNIQUE(account_id)` en `017:324-326`. Usa `config.phone_number_id` en cada llamada (`:349-405`).
3. Reintento por variantes de teléfono y auto-corrección del contacto (`send-message.ts:415-457`): específico de Meta.
4. Banner "WhatsApp no conectado" basado en `whatsapp_config.status` (`page.tsx:182-220, 570-579`).
5. Media entrante servida por `/api/whatsapp/media/[mediaId]` (`use-media-blob-url.ts:24-25`).

**Identidad / contacto**
6. `contactHandle(contact)` (teléfono/@username/BSUID) en header del hilo y sidebar (`message-thread.tsx:992, 1035`, `contact-sidebar.tsx:87`, `lib/whatsapp/wa-identity.ts:155`).
7. Nombre de respaldo `contact.phone` en la lista y en burbujas citadas (`conversation-list.tsx:443`, `message-thread.tsx:1240`); búsqueda por teléfono (`conversation-list.tsx:187`).
8. Notificación de escritorio pide `name, wa_username, phone` (`use-browser-notifications.ts:88`); trigger de asignación usa `COALESCE(name, phone)` (`027:82`).
9. `/api/v1/messages` resuelve conversación **por teléfono** (`resolveConversationByPhone`).

**Reglas de Meta**
10. Ventana de 24 h en cliente (`message-thread.tsx:293-318`) y gating del composer (`message-composer.tsx:207-208, 566-580, 693-699`).
11. Filtro `expiring` y `WINDOW_MS` (`inbox-filters.ts:16-17, 31-35`).
12. Límites: caption 1024, tamaños por tipo, MIME aceptados, audio sin caption (`message-composer.tsx:65-66, 92-101, 402-405, 531-535`; `send-message.ts:174-186`; bucket `023:43-65`).
13. Grabación Ogg/Opus (`message-composer.tsx:194-198, 438-521`).
14. Bucket `chat-media` **público** "para que Meta pueda descargar" (`023:25-27`) — para email/WAHA convendría privado + URL firmada.

**Plantillas e interactivos**
15. `TemplatePicker` + `handleSendTemplate` + `sessionExpiredHint` (`template-picker.tsx:121-123`, `message-thread.tsx:771-836`); vistas `lib/whatsapp/template-body`, `template-message-view` (`message-thread.tsx:52-62`).
16. Builder interactivo validado contra límites de Meta (`lib/whatsapp/interactive`, `message-composer.tsx:55, 327`).
17. Quick replies `kind:'interactive'` (048).

**Mensajes / estados**
18. `messages.message_id` = **wamid**; único `(conversation_id, message_id)` (037) — se usa para reply context y reacciones (`send-message.ts:313-319`, `react/route.ts:65`).
19. `ContentType` cerrado: `text|image|document|audio|video|location|template|interactive` (`types/index.ts:223-232`, CHECK en 001 + 010). Sin `email`, `html`, `note`, `call`, `system`.
20. Mapeo de tipos Meta (`sticker→image`, `button→interactive`) en webhook (`webhook/route.ts:681-691`).
21. Ticks `sent/delivered/read` con `Check/CheckCheck` azul (`message-bubble.tsx:149-153`); errores `error_code/title/details` de Meta (042, `message-bubble.tsx:131-134`).
22. Respuesta `{message_id, whatsapp_message_id}` del send (`send/route.ts:175-179`).
23. Fondo "doodle estilo WhatsApp" (`message-thread.tsx:162-172`) — cosmético.
24. Textos i18n `Inbox.sessionTimer.*`, `whatsappNotConnected`, `sessionExpiredHint`.
25. `message_templates` sin `channel_id` / WABA: el picker mezclaría plantillas de varios números.

**Impacto por canal objetivo**

| Canal | Qué rompe |
|---|---|
| WA Cloud multi-número | `whatsapp_config` única (2), conversación única por contacto (036) → un cliente que escribe a dos números cae en el mismo hilo y se responde desde el número equivocado; plantillas sin número (25). |
| WAHA (no oficial) | Sin ventana 24 h ni plantillas (10, 11, 15): el gating bloquearía el envío. Ids de mensaje WAHA ≠ wamid (18). Ticks parecidos (ACK) pero distinto origen. |
| Email (Mailgun) | Requiere asunto, HTML, CC/BCC, múltiples adjuntos, hilos por `Message-ID/In-Reply-To/References`; nada de esto cabe en `messages` hoy (19). Sin ventana, sin reacciones, sin interactivos. Identidad por email, no teléfono (6-9). |

---

## 5. Lo que falta para enrutamiento por equipos

Estado actual: **ningún concepto de equipo, cola ni canal**. Visibilidad = `is_account_member(account_id)` (`017:414, 511`); asignación = un usuario.

Faltantes y punto de enganche:

| Necesidad | Dónde encaja |
|---|---|
| Tablas `teams`, `team_members`, `channels` (+ `channel_teams` / `channel_members`) | Nuevas migraciones; `channels` sustituye/envuelve `whatsapp_config` (ver doc 02). |
| `conversations.channel_id`, `conversations.team_id` (cola) | Columnas nuevas; el inbound las fija desde el canal receptor (`webhook processMessage`, `webhook/route.ts:619-625`). |
| Visibilidad por equipo/usuario | Reescribir `conversations_select` / `messages_select` / `message_reactions` con una función `can_see_conversation(conv)` (canal visible para el usuario **o** asignado a él **o** rol admin). Como Realtime respeta RLS, las suscripciones sin filtro de `use-realtime.ts` quedan acotadas automáticamente. |
| Asignar a equipo y luego a agente | `assigned_team_id` + `assigned_agent_id`; extender `enforce_conversation_assignee_membership` (055) para exigir que el agente pertenezca al equipo/canal. |
| Quién puede reasignar | Hoy cualquier agent (`017:416`). Mover la escritura a `PATCH /api/conversations/:id` (o RPC) con reglas por rol/equipo y auditoría. |
| Auto-asignación (round-robin / menor carga / presencia) | Punto natural: tras `bump_conversation_on_inbound` en el webhook, junto a `reopenClosedConversation` (`webhook/route.ts:760-776`). La presencia (024) y la carga por agente (059:369) ya existen como insumos. |
| Filtros "Mías", "Mi equipo", "Sin asignar de mi equipo", por canal | `INBOX_FILTERS` (`inbox-filters.ts:3-12`) + selector de canal/equipo en `conversation-list.tsx`. Mejor como filtros en la query (ver 6.3). |
| No leídos por usuario | Tabla `conversation_reads(user_id, conversation_id, last_read_at)`; mantener `unread_count` solo como "pendiente del equipo". |
| Notificaciones | Nuevos `type` (`conversation_unassigned_in_team`, `new_inbound_assigned`) en `notifications` (027:9-10); filtrar notificaciones de escritorio por asignado/equipo (`browser-notify.ts:63-82`). |
| Quick replies / plantillas por equipo o canal | `quick_replies.team_id` / `channel_id` opcionales; plantillas con `channel_id`. |

---

## 6. Recomendaciones de refactor (pragmáticas, mínimo cambio)

### 6.1 Datos
1. **`channels`** (id, account_id, type `wa_cloud|waha|email`, name, config cifrada, status) y `conversations.channel_id NOT NULL` (backfill con el canal WA actual).
2. Cambiar el índice único `idx_conversations_account_contact` (036) por `(account_id, contact_id, channel_id)` **para conversaciones abiertas** o, para email, por hilo (`thread_key`). Decisión de producto: un hilo por contacto+canal (recomendado) vs. hilo unificado por contacto.
3. `messages`: añadir `channel_id` (denormalizado), `external_id` (renombrar conceptualmente `message_id`; mantener la columna), `subject`, `body_html`, `metadata jsonb` (headers email, ACK WAHA), y tabla `message_attachments` (n adjuntos). Ampliar el CHECK de `content_type` con `email` y `note`/`system`.
4. Notas internas en el hilo como `messages` con `sender_type='agent'`, `content_type='note'`, `is_internal=true` (no se envían, sí se ven en el timeline). Reutiliza realtime y orden sin código nuevo.

### 6.2 Envío
5. Extraer de `send-message.ts` un **despachador por canal**: `sendMessageToConversation` conserva validación/persistencia/preview/pausa de flows y delega el `attempt` a un `ChannelAdapter` (`wa_cloud`, `waha`, `mailgun`) elegido por `conversation.channel_id`. Mover a `lib/messaging/` y dejar `lib/whatsapp/` como adaptador.
6. Ruta neutral `POST /api/messages/send` (alias del actual; mantener `/api/whatsapp/send` como wrapper). Lo mismo para reacciones (`/api/messages/react`, solo canales que lo soporten).
7. **Validar la ventana de 24 h en servidor** y solo para `wa_cloud`, usando `conversations.last_inbound_at` (ya mantenido por trigger 059) en lugar de los mensajes cargados.

### 6.3 Inbox UI
8. Introducir `channelCapabilities(channel.type)` → `{ sessionWindowHours: 24|null, templates, interactive, reactions, voiceNotes, subject, html, maxAttachments, maxBytesByKind, acceptMime }` y que el composer, el badge de sesión, el filtro `expiring` y el picker consulten esto en vez de constantes (`message-composer.tsx:65-101`, `message-thread.tsx:293-318`, `inbox-filters.ts:16-35`).
9. Composer por canal: mantener `MessageComposer` para chat (WA Cloud/WAHA, ocultando plantillas/interactivos en WAHA) y añadir `EmailComposer` (asunto, CC, editor HTML, adjuntos múltiples, responder citando). `MessageThread` elige según `channel.type`.
10. `MessageBubble`: rama para `email` (asunto + HTML sanitizado colapsable + adjuntos) y para `note`; ticks solo si el canal reporta estados (`message-bubble.tsx:149-153`).
11. `contactHandle` → `channelHandle(contact, channel)` (teléfono, @usuario, email) para header, lista, búsqueda y notificaciones.
12. Icono/etiqueta de canal en `ConversationItem` (`conversation-list.tsx:436-507`) y filtro por canal/equipo; banner de conexión por canal (estado de sesión WAHA, dominio Mailgun) en lugar de `whatsappConnected` (`page.tsx:182-220`).
13. Paginar la lista: query con `.limit(50)` + cursor por `last_message_at`, y mover filtros de pestaña/canal/equipo a la query (los que dependen de `last_inbound_at/last_reply_at` ya tienen índice en 059:29). Sin esto el inbox se degrada pasado ~1000 conversaciones.

### 6.4 Asignación y estado
14. Sustituir los `update` directos del navegador (`message-thread.tsx:757, 947, 555`) por `PATCH /api/conversations/:id` (status, assignee, team) que valide permisos de equipo, registre `conversation_events` (auditoría/SLA, base para tickets) y emita webhook saliente. Mantener RLS como red de seguridad.
15. Agregar `CanAction` `"assign-conversations"` / `"reassign-others"` en `use-can.ts:19-25` + `lib/auth/roles.ts`.
16. No leídos por usuario (`conversation_reads`) y "marcar como no leído".

### 6.5 Realtime
17. Con visibilidad en RLS no hace falta cambiar `use-realtime.ts`; opcionalmente unificar los 4 canales (`inbox-realtime`, `total-unread-realtime`, `browser-notifications`, `reactions:*`) en un proveedor compartido para reducir conexiones.
18. Para email (hilos largos con HTML) no publicar `body_html` en realtime: emitir el INSERT y que el cliente haga fetch del cuerpo (evita payloads >1 MB del WAL).

### Orden sugerido
1) `channels` + `conversations.channel_id` + índice único nuevo → 2) adaptador de envío + ruta neutral → 3) capacidades por canal en UI → 4) WAHA (reutiliza casi todo el composer) → 5) equipos/visibilidad RLS + PATCH de conversación → 6) email (modelo de mensaje extendido + composer propio) → 7) paginación y no leídos por usuario.
