# 07 · F4 — Canal Email (Mailgun)

Referencia técnica: [investigacion/mailgun.md](../investigacion/mailgun.md).

## Objetivo
Recibir y responder correos de soporte (p. ej. `arriendos@`, `servicioalcliente@`) en el mismo inbox, con hilos correctos en el cliente de correo del usuario final y **log de estado de envío** (aceptado, entregado, fallido, abierto, rebotado, queja).

## Configuración por canal
Un canal `email_mailgun` = **una dirección** sobre un dominio verificado en Mailgun (recomendado subdominio, p. ej. `mg.conexa.<empresa>.com`, o el dominio propio con MX hacia Mailgun).
`config`: `domain`, `region` (`us`|`eu` — el dominio queda atado a una región), `from_name`, `from_address`, `reply_to_mode` (`address` | `token`), `tracking_opens` (default on), `signature_html`.
`secrets`: `api_key` (envío, Basic `api:<key>`), `webhook_signing_key` (verificación).

Al crear el canal la API:
1. Verifica el dominio (`GET /v4/domains/{domain}`) y su estado DNS.
2. Crea/actualiza la **Route**: `match_recipient("^<local>(\+.*)?@<domain>$")` → `store(notify="<api>/webhooks/mailgun/inbound")`, `stop()` — **crudo primero**, ver [ADR-006](../adr/ADR-006-email-raw-primero.md).
3. Registra los **webhooks de eventos** del dominio (`delivered`, `permanent_fail`, `temporary_fail`, `opened`, `complained`, `unsubscribed`) → `<api>/webhooks/mailgun/events`.

Si el correo actual de la empresa está en Google/Microsoft y no se quiere cambiar MX: **reenvío** desde el buzón original a la dirección Mailgun (documentar en runbook); las respuestas salen por Mailgun con `From` del dominio verificado.

## Entrante — crudo primero ([ADR-006](../adr/ADR-006-email-raw-primero.md))

### Webhook `POST /webhooks/mailgun/inbound` (aviso de `store()`)
1. Verificar firma: `hex(HMAC-SHA256(webhook_signing_key, timestamp + token)) == signature`; timestamp ±5 min; `token` no repetido.
2. Resolver canal por `recipient` (quitando `+token`). Sin canal → **406** (Mailgun no reintenta).
3. Una transacción: `inbound_events` (`dedupe_key` = clave de almacenamiento de Mailgun) + `send('email.fetch_raw')` → **200**. Nada más en el request.

### Job `email.fetch_raw`
4. Descargar el **MIME crudo** desde `message-url` (`Accept: message/rfc2822`) → Storage privado `email-raw/…/<eventId>.eml` con SHA-256 y tamaño (`inbound_events.raw_*`).
5. Descargar la versión **parseada por Mailgun** (`stripped-text`, `stripped-html`, `message-headers`, `content-id-map`) → snapshot en `inbound_events.payload` (sin adjuntos).
6. Encolar `inbound.ingest`. Reintentos con backoff; Mailgun conserva el mensaje ~3 días; la DLQ alerta antes de que expire.

### Job `inbound.ingest` (email) — sólo lee lo ya guardado
7. Parsear el `.eml` con librería MIME (charsets, adjuntos, inline `cid:`, headers `Message-Id`, `In-Reply-To`, `References`, `Cc`, `Auto-Submitted`, `X-Autoreply`, `Authentication-Results`).
8. **Hilo** (orden):
   1. `In-Reply-To` = `message_id` (`external_id` en la API) de un mensaje nuestro → esa conversación.
   2. `References` (del más reciente al más antiguo).
   3. Token en la dirección `local+<token>@domain` (token opaco firmado ↔ conversación).
   4. Si no → **conversación nueva** con `thread_key = Message-Id` y `subject`.
9. Identidad `email` (normalizada) → contacto (`resolveContact`). Nombre desde el `From`.
10. Mensaje: `content_type='email'`, `content_text = stripped-text` del snapshot (fallback: texto del .eml), `body_html = stripped-html` (fallback: HTML del .eml) **sanitizado al renderizar** (DOMPurify en la web; nunca HTML sin sanear), `metadata.headers` (subset), `metadata.cc`, `metadata.auth` (SPF/DKIM/DMARC), `inbound_event_id`; adjuntos extraídos → `message_attachments`, imágenes inline resueltas por `cid`.
11. Auto-respuestas (`Auto-Submitted: auto-*`, `X-Autoreply`, `Precedence: bulk|auto_reply`): se registran pero **no reabren** la conversación ni disparan automations/IA.
12. **Reproceso**: `POST /admin/inbound-events/:id/reprocess` repite 7–11 desde lo guardado, sin consultar Mailgun. Idempotente por `Message-Id` + canal.
13. UI: acción **"Ver original / descargar .eml"** en cada correo (descarga como adjunto, nunca renderizado).

Respuestas HTTP del webhook: 200 = aceptado; **406 = rechazo definitivo** (firma inválida, destinatario sin canal); 5xx sólo ante fallo nuestro (Mailgun reintenta).

## Saliente (adapter)
`POST https://api[.eu].mailgun.net/v3/{domain}/messages.mime` (multipart: `to` + `message`; decidido 2026-11-10, [ADR-006](../adr/ADR-006-email-raw-primero.md)). El MIME lo construimos nosotros; el `.eml` saliente se guarda primero en `email-raw` (`direction=out`) y después se envía. Lo siguiente son cabeceras y partes de ese MIME, salvo `v:` y `o:`, que van como parámetros del POST:
- `from`: `"<Nombre agente> vía <from_name>" <from_address>`; `to`: email del contacto; `cc` opcional.
- `subject`: `Re: <asunto original>` (sin duplicar "Re:").
- `text` + `html` (composer de email: texto enriquecido básico + firma del canal).
- `In-Reply-To` = `message_id` (`external_id` en la API) del último mensaje entrante; `References` = cadena de Message-Ids del hilo (cap. ~20).
- `Reply-To` = `local+<token>@domain` si `reply_to_mode=token`.
- `v:conexa_message_id`, `v:conexa_conversation_id` (vuelven en los eventos).
- `o:tracking-opens` según canal; `o:tracking-clicks=no` (no reescribir enlaces de soporte).
- adjuntos como partes MIME, leídos de Storage.
- `Message-Id` **propio**, generado antes de enviar → `messages.message_id` (`external_id` en la API; base del hilo). No se depende del `id` que devuelve Mailgun. ⚠️ Verificar en pruebas que Mailgun conserva ese `Message-Id`.
- Capacidades: `subject, html, cc, maxAttachments: 10, maxMediaBytes: 25 MB, replyWindowHours: null, templates: false, reactions: false`.

## Log de estados — `POST /webhooks/mailgun/events`
1. JSON `{ signature: { timestamp, token, signature }, "event-data": {…} }` → verificar igual que arriba.
2. Mensaje por `event-data.user-variables.conexa_message_id` (fallback `message.headers.message-id`).
3. Insertar en `message_delivery_events` (`event`, `severity`, `reason`, `delivery-status.message`, `raw`).
4. Estado resumido monotónico: `accepted`→`sent`, `delivered`→`delivered`, `opened`→`read`, `failed(permanent)`→`failed` (+ `error_title`), `failed(temporary)`→ sólo log.
5. `complained`/`unsubscribed` → marcar identidad email del contacto (`metadata.email_status`) y avisar en la UI.
6. **Reconciliación**: job cada 15 min consulta la Events API del dominio para mensajes salientes de las últimas 24 h sin estado final (por si se perdió un webhook).

En la UI, cada mensaje de email muestra su estado y un desplegable con el **historial completo** de eventos.

## Aceptación
1. Correo de Gmail a `arriendos@…` crea conversación con asunto, texto, HTML saneado y adjuntos.
2. Respuesta desde Conexa aparece en Gmail **en el mismo hilo**; la respuesta del cliente vuelve a la misma conversación.
3. Un correo nuevo del mismo cliente con otro asunto crea otra conversación.
4. Envío a dirección inexistente → mensaje `failed` con motivo de rebote visible; historial muestra `accepted` → `failed`.
5. Apertura del correo → estado `read` (si tracking activo).
6. Firma inválida → nada persistido.
7. Un auto-reply "fuera de oficina" no reabre una conversación cerrada.
8. Cada correo recibido tiene su `.eml` en `email-raw` con SHA-256; "descargar original" devuelve un archivo idéntico byte a byte.
9. Reprocesar un correo (tras borrar su mensaje) lo reconstruye igual sin consultar Mailgun.
