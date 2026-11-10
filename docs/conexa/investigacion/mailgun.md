# Mailgun: envío y recepción de correo de soporte para Conexa

> Fecha de investigación: 2026-11-09.

Fuentes:
- Envío (API Messages): https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages/post-v3--domain-name--messages
- Routes: https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/routes
- Recepción por HTTP (campos parseados): https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http
- Webhooks de eventos: https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/webhooks
- Payloads de webhooks: https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/webhook-payloads
- Seguridad de webhooks: https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks
- Events / Logs: https://documentation.mailgun.com/docs/mailgun/user-manual/events/events y https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/logs/post-v1-analytics-logs
- API de Routes: https://documentation.mailgun.com/docs/mailgun/api-reference/openapi-final/tag/Routes
- API de Webhooks: https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/webhooks

---

## 1. Conceptos básicos

| Tema | Detalle |
|---|---|
| Base URL **US** | `https://api.mailgun.net` |
| Base URL **EU** | `https://api.eu.mailgun.net` |
| Región | Un dominio vive en **una** región, que se elige al crearlo. Las llamadas a la API (envío, routes, events, webhooks) deben ir a la base URL de esa región. Si se usa la base equivocada, el dominio aparece como "not found" (401/404). Para Colombia no hay requisito legal de usar la UE; lo normal es **US** por latencia. Si se necesita residencia de datos en la UE, hay que crear el dominio en EU desde el principio, porque no se puede migrar. |
| Auth | HTTP Basic, usuario `api` y password `<API key>`. Las *Domain Sending Keys* sirven solo para enviar en un dominio (mínimo privilegio). Recomendado para el worker de envío. |
| Firma de webhooks | **HTTP webhook signing key** (Settings → API Security). No es la API key. |
| DNS | SPF (TXT), DKIM (TXT), MX hacia `mxa/mxb.mailgun.org` (o `mxa.eu…`) para recibir, y CNAME de tracking (`email.<dominio>`) para opens/clicks. |

**Dominios por canal (recomendación):**
- Usar un subdominio dedicado para soporte, por ejemplo `soporte.inmobiliaria.co` o `mg.inmobiliaria.co`, con su MX en Mailgun. Así el dominio raíz sigue en Google Workspace/M365 y la reputación transaccional queda aislada.
- Cada "buzón" de Conexa (canal email) = una dirección (`soporte@`, `arriendos@`, `ventas@`) en ese dominio más **una Route** que la reenvía al webhook de Conexa.
- Si el cliente quiere seguir usando `soporte@inmobiliaria.co` (dominio raíz en Google), se puede configurar en Google un **reenvío automático** hacia `soporte@mg.inmobiliaria.co`. El envío sale desde Mailgun con `From: soporte@inmobiliaria.co`, para lo que hay que agregar Mailgun al SPF y DKIM del dominio raíz (o verificar el dominio raíz en Mailgun solo para envío).

## 2. Envío: `POST /v3/{domain}/messages`

`multipart/form-data` (obligatorio si hay adjuntos).

| Campo | Uso en Conexa |
|---|---|
| `from` | `"Inmobiliaria Soporte <soporte@mg.inmobiliaria.co>"` |
| `to`, `cc`, `bcc` | Se pueden repetir |
| `subject` | Usar `Re: <asunto original>` en las respuestas |
| `text`, `html` | Enviar ambos |
| `attachment` | Se repite por cada archivo (multipart) |
| `inline` | Imágenes embebidas, referenciadas con `cid:` |
| `h:<Header>` | Headers MIME arbitrarios: **`h:In-Reply-To`, `h:References`, `h:Reply-To`**, `h:X-Conexa-Conversation` |
| `v:<var>` | Variables custom. **Vuelven en todos los webhooks y eventos** dentro de `user-variables`. Ej.: `v:conexa_message_id`, `v:conexa_conversation_id` |
| `o:tag` | Hasta varias etiquetas (ej. `channel:soporte`) |
| `o:tracking`, `o:tracking-opens`, `o:tracking-clicks` | `yes`/`no`/`htmlonly`. En soporte se recomienda **opens sí, clicks no**: reescribir links de clientes molesta y activa filtros |
| `o:testmode` | `yes` en staging (no se entrega, pero genera eventos) |
| `o:require-tls` | Opcional |
| `o:deliverytime` | Envío programado (RFC 2822) |

Límites: el total de `o:`/`h:`/`v:`/`t:` es como máximo 16 KB. Los valores `v:` de más de 4 KB se truncan en eventos y webhooks. `recipient-variables` admite como máximo 1000 destinatarios por batch.

Ejemplo (curl):
```bash
curl -s --user "api:$MG_KEY" https://api.mailgun.net/v3/mg.inmobiliaria.co/messages \
  -F from='Soporte Inmobiliaria <soporte@mg.inmobiliaria.co>' \
  -F to='cliente@gmail.com' \
  -F subject='Re: Daño en la cocina - Apto 502' \
  -F text='Hola Ana, ya agendamos la visita…' \
  -F html='<p>Hola Ana, ya agendamos la visita…</p>' \
  -F 'h:In-Reply-To=<CAF=abc123@mail.gmail.com>' \
  -F 'h:References=<CAF=abc000@mail.gmail.com> <CAF=abc123@mail.gmail.com>' \
  -F 'h:Reply-To=soporte+c_8f3k2q@mg.inmobiliaria.co' \
  -F 'v:conexa_message_id=2b1e…' -F 'v:conexa_conversation_id=8f3k…' \
  -F 'o:tracking-clicks=no' -F 'o:tag=canal:soporte' \
  -F attachment=@cotizacion.pdf
```

Respuesta:
```json
{ "id": "<20261109153012.1a2b3c4d5e@mg.inmobiliaria.co>", "message": "Queued. Thank you." }
```
**El `id` devuelto ES el `Message-Id` del correo enviado** (con `<>`). Hay que guardarlo en `messages.message_id` (`external_id` en la API) y en la tabla de hilos para hacer el matching de las respuestas.

> Sobre fijar nuestro propio `Message-Id` con `h:Message-Id`: la referencia actual de la API no lo documenta. No dependemos de eso, porque basta con guardar el `id` que devuelve la API. Si se quiere un id generado por nosotros, hay que probarlo primero en sandbox.

## 3. Recepción: Routes

**Modelo:**
- Una Route = filtro + acciones + prioridad (menor número = mayor prioridad).
- Por defecto se evalúan *todas* las routes que hagan match; `stop()` corta la evaluación.
- Los campos Filter y Action tienen como máximo 4 KB cada uno.
- Las routes son a nivel de cuenta y región; no van atadas al dominio. El filtro es el que decide.

Filtros:
- `match_recipient("soporte@mg.inmobiliaria.co")`, que acepta regex: `match_recipient("^soporte\+(.*)@mg\.inmobiliaria\.co$")` (los grupos capturados se pueden usar en la acción como `\1`).
- `match_header("subject", ".*urgente.*")`
- `catch_all()`

Acciones:
- `forward("https://conexa.example.com/api/webhooks/mailgun/inbound")` hace un POST con el mensaje **parseado**. También puede reenviar a un email.
- `store(notify="https://…")` guarda el mensaje (unos 3 días) y notifica a la URL con el mismo payload más `message-url` para descargarlo después con la API (`GET` sobre `storage.url` con auth).
- `stop()`

API: `POST /v3/routes` (form: `priority`, `description`, `expression`, `action` (se repite)), `GET /v3/routes`, `PUT /v3/routes/{id}`, `DELETE /v3/routes/{id}`.

Ejemplo para un canal:
```
priority: 10
expression: match_recipient("^soporte(\+.*)?@mg\.inmobiliaria\.co$")
action: forward("https://conexa.example.com/api/webhooks/mailgun/inbound?channel=soporte")
action: stop()
```

### Formato del POST de `forward()`

El formato depende del sufijo de la URL destino:

| Sufijo de la URL | Content-Type | Notas |
|---|---|---|
| (normal) | `application/x-www-form-urlencoded`, o `multipart/form-data` si hay adjuntos | Campos parseados |
| termina en `mime` / `raw-mime` | urlencoded | Trae `body-mime` (el MIME crudo); no trae `body-plain` ni `body-html` |
| termina en `json` | `application/json` | Adjuntos en `attachments[]` con `{filename, content-type, content(base64)}`. La firma viaja en los headers `X-Mailgun-Signature`, `X-Mailgun-Timestamp` (y `X-Mailgun-Parent-Signature`) |

**Campos parseados:**

| Campo | Contenido |
|---|---|
| `recipient` | Destinatario SMTP (RCPT TO). **Clave para el token `soporte+<conv>@`** |
| `sender` | Remitente SMTP (MAIL FROM / return-path). Puede diferir de `From` |
| `from` | Header From (`"Ana Pérez <ana@gmail.com>"`). Usarlo para identificar el contacto |
| `subject` | Asunto |
| `body-plain` | Texto completo (siempre presente; si el correo es solo HTML, Mailgun lo genera) |
| `stripped-text` | Texto **sin citas ni firma**. Es lo ideal para mostrar en el timeline |
| `stripped-signature` | La firma que se removió |
| `body-html` | HTML completo |
| `stripped-html` | HTML sin las partes citadas |
| `message-headers` | JSON string `[[name, value], …]` con **todos** los headers en orden. Aquí están de forma fiable `Message-Id`, `In-Reply-To`, `References`, `Cc`, `Date`, `Auto-Submitted` y `X-Autoreply` |
| `Message-Id`, `In-Reply-To`, `References`, `Date`, `To`, `Cc`… | En el formato form, Mailgun además publica los headers MIME como campos sueltos. Son útiles, pero hay que tomar como fuente de verdad `message-headers`, porque los nombres pueden repetirse en distinta capitalización |
| `attachment-count` | Número de adjuntos |
| `attachment-1` … `attachment-N` | Archivos (multipart) |
| `content-id-map` | JSON `{"<cid>": "attachment-1"}` para las imágenes inline |
| `timestamp`, `token`, `signature` | Firma (ver la sección 5) |

**Códigos de respuesta:**
- **200**: OK, no se reintenta.
- **406**: rechazado, no se reintenta.
- **Cualquier otro código**: Mailgun reintenta durante **8 horas** (10 min, 15 min, 30 min, 1 h, 2 h y 4 h).

El endpoint debe responder rápido (encolar y devolver 200) y ser idempotente por `Message-Id`.

## 4. Webhooks de eventos (estado de los correos enviados)

Tipos configurables: `accepted`, `delivered`, `temporary_fail`, `permanent_fail`, `opened`, `clicked`, `unsubscribed`, `complained`.

En el payload, ambos fallos llegan como `event: "failed"` con `severity: "temporary" | "permanent"`.

Configuración:
- Por dominio con `POST /v3/domains/{domain}/webhooks` (form `id=delivered`, `url=https://…`; hay una variante v4 `PUT /v4/domains/{domain}/webhooks` para varios eventos a la vez).
- También a nivel de cuenta (`/v1/webhooks`).
- Política de reintentos: se reintenta si la respuesta no es 2xx (8 horas). Un 406 indica que no se reintente.

Payload (cuerpo JSON):
```json
{
  "signature": { "timestamp": "1762700000", "token": "a8ce0edb2dd8301dee6c2405235584e45aa91d1e9f979f3de0", "signature": "d2271d12299f6592d9d44cd9d250f0704e4674c30d79d07c47a66f95ce71cf55" },
  "event-data": {
    "event": "failed", "severity": "permanent", "reason": "bounce",
    "id": "2kFItcrLQuKTdp-Ia2Xr7w", "timestamp": 1770918175.59,
    "recipient": "cliente@dominio-inexistente.co",
    "message": { "headers": { "message-id": "20261109153012.1a2b3c4d5e@mg.inmobiliaria.co" } },
    "user-variables": { "conexa_message_id": "2b1e…", "conexa_conversation_id": "8f3k…" },
    "tags": ["canal:soporte"],
    "delivery-status": { "code": 550, "message": "5.1.1 mailbox unavailable", "description": null }
  }
}
```

Correlación:
- `event-data.user-variables.conexa_message_id` (preferido), o
- `event-data.message.headers.message-id` (llega **sin** `<>`; hay que normalizar).

Mapa de estados en Conexa:

| Evento | Estado en Conexa |
|---|---|
| `accepted` | `queued` |
| `delivered` | `delivered` |
| `failed` / temporary | `retrying` |
| `failed` / permanent | `failed` (mostrar `delivery-status.message`) |
| `opened` | `read` (aproximado: los proxies de Apple y Gmail inflan los opens) |
| `complained` | Marcar el contacto y alertar |
| `unsubscribed` | Marcar el contacto (raro en soporte) |

La documentación advierte que se pueden agregar campos nuevos, así que no hay que validar los payloads con un esquema estricto.

## 5. Verificación de firma (inbound y eventos)

El algoritmo es el mismo en los dos casos:

1. `signing_key` = **HTTP webhook signing key** de la cuenta.
2. `expected = hex( HMAC_SHA256(signing_key, timestamp + token) )`. Es una concatenación simple, sin separador.
3. Comparar con `signature` en tiempo constante.
4. Contra replays: cachear el `token` (Redis o una tabla con TTL) y rechazar los repetidos. Rechazar también los `timestamp` muy viejos, con una ventana generosa (~10–15 min), porque hay reintentos.

Dónde viajan los valores:
- **Eventos:** `body.signature.{timestamp, token, signature}`.
- **Routes (form o multipart):** campos top-level `timestamp`, `token` y `signature`.
- **Routes con URL `…json`:** headers `X-Mailgun-Timestamp` y `X-Mailgun-Signature`. Según la documentación, en JSON se usa **el cuerpo completo del request en lugar del `token`** al calcular el HMAC.

```ts
import crypto from "node:crypto";
export function verifyMailgun(key: string, ts: string, token: string, sig: string) {
  const exp = crypto.createHmac("sha256", key).update(ts + token).digest("hex");
  return exp.length === sig.length && crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(sig));
}
```

## 6. Events API / Logs API (polling y reconciliación)

- **Legado:** `GET /v3/{domain}/events`. Acepta los filtros `begin`, `end`, `ascending`, `limit` (máx. 300), `event`, `recipient`, `message-id` y `tags`. Se pagina con `paging.next` hasta recibir una página vacía. La documentación de Events no lo marca como deprecado; otras APIs (Bounce Classification) sí remiten a Logs.
- **Nuevo:** `POST /v1/analytics/logs` (a nivel de cuenta):
```json
{ "start": "Mon, 09 Nov 2026 00:00:00 +0000", "end": "Mon, 09 Nov 2026 23:59:59 +0000",
  "events": ["delivered", "failed"],
  "filter": { "AND": [ { "attribute": "domain", "comparator": "=", "values": [ { "label": "mg.inmobiliaria.co", "value": "mg.inmobiliaria.co" } ] } ] },
  "pagination": { "sort": "timestamp:asc", "limit": 100 } }
```
  - La respuesta trae `items[]` (`id`, `event`, `@timestamp`, `recipient`, `delivery-status`, `message`…) y `pagination.next` (token).
  - Atributos filtrables: `id`, `domain`, `event`, `recipient`, `tag`, `severity` y `delivery_status_code`.
  - El valor exacto de `comparator` debe confirmarse en la referencia (el ejemplo de arriba es ilustrativo).
- Retención: **30 días** (depende del plan).
- Uso en Conexa: **un cron de reconciliación** (por ejemplo, cada hora) que busque los mensajes salientes sin estado final después de N minutos. No se usa como fuente principal: la principal son los webhooks. Hay que hacer polling con ventanas que terminen unos minutos en el pasado, porque los eventos pueden tardar en "asentarse".

## 7. Estrategia de threading recomendada

Objetivo: que cada correo entrante caiga en la conversación correcta.

**Al enviar (respuesta del agente):**
1. `h:In-Reply-To` = `Message-Id` del último mensaje del cliente en la conversación.
2. `h:References` = `References` de ese mensaje más su `Message-Id`, separados por espacio (cadena RFC 5322). Si queda muy larga, conservar el primero y los últimos ~10.
3. `h:Reply-To` = `soporte+<token>@mg.inmobiliaria.co`, donde `<token>` es un id corto y no adivinable de la conversación (por ejemplo, 10 caracteres base32 o un HMAC truncado del `conversation_id`). **No exponer el UUID crudo.**
4. `subject` = `Re: <asunto>`. Opcionalmente se puede agregar `[#C-1234]`, al estilo osTicket, como tercer fallback visible.
5. Guardar `id` (el Message-Id devuelto) en `email_message_ids(message_id, conversation_id)`.

**Al recibir (orden de matching):**
1. **`In-Reply-To`**: buscar el Message-Id en `email_message_ids`. Si existe, es esa conversación.
2. **`References`**: recorrerlos de derecha a izquierda (el más reciente primero) y buscar cada uno.
3. **Token del destinatario**: si `recipient` coincide con `soporte+(token)@`, se resuelve la conversación por el token. Esto cubre clientes de correo que no envían los headers (algunos móviles, reenvíos). La regex de la Route debe aceptar el `+`.
4. **Token en el asunto** `[#C-1234]` (opcional).
5. **Heurística débil** (opcional): mismo `from` y asunto normalizado (sin `Re:`, `RE:`, `Fwd:`, `RV:`, `Rta:`) con una conversación abierta de los últimos N días. Si se aplica, marcarlo como "auto-asociado" para que el agente lo revise.
6. Si nada coincide, se crea una **conversación nueva**.

Además:
- Guardar siempre el `Message-Id` del entrante para deduplicar los reintentos de Mailgun y para encadenar el siguiente envío.
- Detectar **auto-respuestas** (`Auto-Submitted: auto-replied`, `X-Autoreply`, `Precedence: bulk/auto_reply`) y rebotes, para no reabrir tickets ni crear bucles de respuestas automáticas.
- Mostrar `stripped-text` (o `stripped-html`) en el timeline, conservando `body-html` completo para "ver original".
- Si el cliente agrega a alguien en CC, guardar los CC del entrante y, al responder, preguntar si se responde a todos.
- Varios dominios o canales: la Route agrega `?channel=<slug>` a la URL del webhook. Así el handler identifica el canal sin parsear el destinatario (aunque igual hay que validar `recipient`).

## 8. Gotchas

- El webhook de inbound y los adjuntos grandes pesan. Next.js en Vercel tiene un límite de body (~4.5 MB en funciones serverless). Opciones:
  - Usar `store(notify=…)` y descargar el MIME o los adjuntos desde `message-url` en un worker.
  - Alojar el endpoint de ingesta fuera de Vercel (una Supabase Edge Function también tiene límites).
  - **Recomendación:** `store(notify=URL)`, más un fetch del mensaje almacenado desde un job.
- La firma usa la signing key de la cuenta, no la API key. Si se rota, se rompe la verificación.
- Hay que tener en cuenta la región (US/EU) en todas las llamadas.
- Los open-tracking no son fiables y el click-tracking reescribe los links. Hay que desactivar clicks en soporte.
- `message-headers` puede traer duplicados como `subject` y `Subject`.
- Sandbox domain: solo envía a destinatarios autorizados. Para pruebas reales se necesita un dominio verificado.
