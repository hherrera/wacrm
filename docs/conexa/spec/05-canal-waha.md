# 05 · F2 — WhatsApp no oficial vía WAHA (QR)

Referencia técnica: [investigacion/waha.md](../investigacion/waha.md) · OpenAPI: https://waha.devlike.pro/swagger/openapi.json · Decisión: [ADR-005](../adr/ADR-005-waha.md).

## Objetivo
Conectar números de WhatsApp "normales" o Business App (los que hoy usan asesores/áreas en celulares) escaneando un QR, y atenderlos desde el mismo inbox.

> ⚠️ Riesgo: el uso no oficial viola los Términos de WhatsApp y puede llevar al **bloqueo del número**. Uso recomendado: números existentes con conversaciones *iniciadas por el cliente*; **prohibido** usarlo para envíos masivos/broadcasts. La UI lo advierte al crear el canal.

## Despliegue
- Un contenedor `devlikeapro/waha` **≥ 2026.6.1** (desde esa versión las funciones Plus — multi-sesión, media, almacenamiento — están en la imagen libre). Versión fijada por tag, nunca `latest`.
- Motor **GOWS** (sin navegador, menor consumo). Almacenamiento de sesiones en volumen persistente (o Postgres).
- Red interna: sólo `apps/api` llega a WAHA. `WAHA_API_KEY` (hash `sha512:` en WAHA), HMAC de webhooks activado.
- Una instancia WAHA sirve todas las sesiones (canales). `channels.config.waha_base_url` permite varias instancias si crece.

## Ciclo de vida del canal
| Acción en Conexa | WAHA |
|---|---|
| Crear canal | `POST /api/sessions` `{ name: "cx_<channelId-corto>", start: true, config: { metadata: { channel_id }, webhooks: [{ url: "<api>/webhooks/waha", events: ["message.any","message.ack","message.reaction","message.revoked","session.status"], hmac: { key } }] } }` |
| Mostrar QR | `GET /api/{session}/auth/qr?format=image` (Accept JSON → base64). Refresco cada ~20 s; tras 6 intentos → `FAILED`. UI con polling 5 s + evento `session.status`. |
| Vincular por código (alternativa) | `POST /api/{session}/auth/request-code { phoneNumber }` |
| Conectado | `session.status = WORKING` → `GET /api/sessions/{session}/me` → `channels.address` = número, `status=connected` |
| Reiniciar | `POST /api/sessions/{s}/restart` |
| Desvincular | `POST /api/sessions/{s}/logout` (conserva config) |
| Eliminar canal | `POST .../stop` + `DELETE /api/sessions/{s}` |

Estados WAHA → `channels.status`: `STARTING`→`pending`, `SCAN_QR_CODE`→`pending` (detalle "esperando QR"), `WORKING`→`connected`, `STOPPED`→`disconnected`, `FAILED`→`error`.

## Entrante
`POST /webhooks/waha`:
1. Verificar `X-Webhook-Hmac` (HMAC-SHA512 del cuerpo crudo con la clave del canal) + `X-Webhook-Timestamp` (ventana 5 min). Canal desde `payload.metadata.channel_id` (fallback: `session`).
2. Guardar `inbound_events` (dedupe `waha:<payload.id>`), responder 200.
3. Por evento:
   - `message.any` con `fromMe=false` → `InboundEvent` (identidad desde `from`: `@c.us` → phone, `@lid` → `waha_lid`). Ignorar `@g.us` (grupos), `@newsletter`, `status@broadcast` en el MVP.
   - `message.any` con `fromMe=true` y `source=app` → mensaje **saliente enviado desde el celular**: se registra como `direction='out'`, `sender_type='agent'`, `sender_id=null`, `metadata.source='phone'` (así el hilo queda completo).
   - `hasMedia` → job `media.mirror` **inmediato**: descargar `media.url` con `X-Api-Key` y subir a Storage (WAHA borra los archivos a los 180 s por defecto — `WHATSAPP_FILES_LIFETIME`; subirlo a 3600 como margen. Alternativa: `WAHA_MEDIA_STORAGE=S3` apuntando al S3 de Supabase Storage y evitar la copia).
   - `message.ack` → `StatusEvent` (`-1`→failed, `1`→sent, `2`→delivered, `3`/`4`→read).
   - `message.reaction` → reacción (texto vacío = quitar).
   - `message.revoked` → marcar mensaje `metadata.revoked=true` (no borrar).
   - `session.status` → actualizar canal; si `FAILED`/`STOPPED` inesperado → notificar admins del canal.

## Saliente (adapter)
| Tipo | Endpoint |
|---|---|
| texto | `POST /api/sendText { session, chatId, text, reply_to? }` |
| imagen | `POST /api/sendImage { session, chatId, file:{mimetype,url}, caption }` |
| documento/video | `POST /api/sendFile` / `sendVideo` |
| nota de voz | `POST /api/sendVoice { file, convert: true }` |
| marcar leído | `POST /api/sendSeen { session, chatId, messageIds }` (al abrir conversación) |
| escribiendo | `POST /api/startTyping` / `stopTyping` (opcional) |
| reacción | `PUT /api/reaction { session, messageId, reaction }` |

- `file.url` = URL firmada de Storage (corta duración) accesible desde WAHA.
- `externalId` = `id` devuelto; los acks posteriores se aplican vía `message-status-sync` (que ya tolera acks antes del insert).
- Capacidades: `templates:false, interactive:false, reactions:true, replyWindowHours:null, voiceNotes:true, typing:true, readReceipts:true`.
- **Limitador** por canal (p. ej. 1 msg/s, ráfaga 5) y bloqueo de envío a contactos que nunca escribieron a ese canal (configurable) para reducir riesgo de baneo. En errores 463/475 → pausar canal, no reintentar.

## Automatizaciones / IA en WAHA
- Automations y auto-reply IA: **sí** (son texto).
- Flows con botones/listas: **no** en MVP (no se disparan en canales sin `interactive`).

## Aceptación
1. Crear canal → QR en pantalla → escanear → estado `connected` con el número en < 10 s.
2. Mensaje de texto, imagen, audio y documento entrantes aparecen con media reproducible (también pasados 10 min).
3. Respuesta desde Conexa llega al cliente; ticks pasan a entregado/leído.
4. Mensaje enviado desde el celular vinculado aparece en el hilo marcado "desde teléfono".
5. Cerrar sesión desde el celular → canal `disconnected` y notificación a admins en < 5 min.
6. Webhook con HMAC inválido → 401 y nada persistido.
