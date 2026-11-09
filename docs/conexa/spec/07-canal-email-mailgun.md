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
2. Crea/actualiza la **Route**: `match_recipient("^<local>(\+.*)?@<domain>$")` → `forward("<api>/webhooks/mailgun/inbound")`, `stop()`.
3. Registra los **webhooks de eventos** del dominio (`delivered`, `permanent_fail`, `temporary_fail`, `opened`, `complained`, `unsubscribed`) → `<api>/webhooks/mailgun/events`.

Si el correo actual de la empresa está en Google/Microsoft y no se quiere cambiar MX: **reenvío** desde el buzón original a la dirección Mailgun (documentar en runbook); las respuestas salen por Mailgun con `From` del dominio verificado.

## Entrante — `POST /webhooks/mailgun/inbound`
1. `multipart/form-data`. Verificar firma: `hex(HMAC-SHA256(webhook_signing_key, timestamp + token)) == signature`; timestamp ±5 min; `token` no repetido (dedupe en `inbound_events`).
2. Resolver canal por `recipient` (quitando `+token`).
3. Extraer: `sender`/`from`, `subject`, `body-plain`, `stripped-text`, `body-html`, `stripped-html`, `message-headers` (JSON → `Message-Id`, `In-Reply-To`, `References`, `Auto-Submitted`, `X-Autoreply`, `Cc`), `attachment-N`, `content-id-map`.
4. **Hilo** (orden):
   1. `In-Reply-To` = `external_id` de un mensaje nuestro → esa conversación.
   2. `References` (del más reciente al más antiguo).
   3. Token en la dirección `local+<token>@domain` (token opaco firmado ↔ conversación).
   4. Si no → **conversación nueva** con `thread_key = Message-Id` y `subject`.
5. Identidad `email` (normalizada) → contacto (`resolveContact`). Nombre desde el `From`.
6. Mensaje: `content_type='email'`, `content_text = stripped-text` (fallback `body-plain`), `body_html = stripped-html` (fallback `body-html`) **sanitizado al renderizar** (DOMPurify en la web; nunca HTML sin sanear), `metadata.headers` (subset), `metadata.cc`, adjuntos → `message_attachments` en Storage, imágenes inline resueltas por `content-id-map`.
7. Auto-respuestas (`Auto-Submitted: auto-*`, `X-Autoreply`, `Precedence: bulk|auto_reply`): se registran pero **no reabren** la conversación ni disparan automations/IA.
8. Respuestas HTTP: 200 = procesado; **406 = rechazo definitivo** (firma inválida, destinatario sin canal) para que Mailgun no reintente; 5xx sólo ante fallo nuestro (Mailgun reintenta hasta ~8 h).
9. Correos grandes: la Route puede usar `store(notify=…)` y un job descarga el mensaje almacenado (evita límites de body).

## Saliente (adapter)
`POST https://api[.eu].mailgun.net/v3/{domain}/messages` (multipart):
- `from`: `"<Nombre agente> vía <from_name>" <from_address>`; `to`: email del contacto; `cc` opcional.
- `subject`: `Re: <asunto original>` (sin duplicar "Re:").
- `text` + `html` (composer de email: texto enriquecido básico + firma del canal).
- `h:In-Reply-To` = `external_id` del último mensaje entrante; `h:References` = cadena de Message-Ids del hilo (cap. ~20).
- `h:Reply-To` = `local+<token>@domain` si `reply_to_mode=token`.
- `v:conexa_message_id`, `v:conexa_conversation_id` (vuelven en los eventos).
- `o:tracking-opens` según canal; `o:tracking-clicks=no` (no reescribir enlaces de soporte).
- adjuntos `attachment` desde Storage.
- Respuesta `{ id: "<…@domain>" }` → `messages.external_id` (= Message-Id del correo enviado; base del hilo).
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
