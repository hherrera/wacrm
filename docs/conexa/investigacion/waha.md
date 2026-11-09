# WAHA (WhatsApp HTTP API): investigación para Conexa

> Fecha de investigación: 2026-11-09. Versión de la OpenAPI revisada: **2026.10.1** (`https://waha.devlike.pro/swagger/openapi.json`).
> WAHA es una API HTTP **no oficial**, autoalojada, que se vincula a un número de WhatsApp normal (o Business App) escaneando un código QR, igual que WhatsApp Web. No usa la WhatsApp Cloud API de Meta.

Fuentes principales:
- Documentación: https://waha.devlike.pro/docs/
- Sesiones: https://waha.devlike.pro/docs/how-to/sessions/
- Eventos / webhooks: https://waha.devlike.pro/docs/how-to/events/ (la URL antigua `/docs/how-to/webhooks/` redirige aquí)
- Engines: https://waha.devlike.pro/docs/how-to/engines/
- Seguridad: https://waha.devlike.pro/docs/how-to/security/
- Recibir mensajes y media: https://waha.devlike.pro/docs/how-to/receive-messages/
- Almacenamiento: https://waha.devlike.pro/docs/how-to/storages/
- Plus/Core: https://waha.devlike.pro/docs/how-to/waha-plus/
- Cómo evitar bloqueos: https://waha.devlike.pro/docs/overview/how-to-avoid-blocking/
- OpenAPI: https://waha.devlike.pro/swagger/openapi.json

---

## 1. Licenciamiento: Core vs Plus (multi-sesión)

**Cambio importante:** desde la versión **2026.6.1**, *WAHA Plus se fusionó en WAHA Core*. La página de Plus dice textualmente: "WAHA Plus is now part of WAHA Core". Las funciones que antes eran de pago ("unlimited sessions, multimedia messages, all storages, built-in security, and more") ahora vienen en la imagen pública `devlikeapro/waha`.

- La imagen `devlikeapro/waha-plus` y el login a Docker con la clave del Patron Portal **ya no hacen falta**.
- Solo queda un tier "Community" de donación (~USD 5/mes en Patreon/Boosty/cripto) que "no da nada extra".
- **Consecuencia para Conexa:** podemos tener **varias sesiones (varios números de WhatsApp) en una sola instancia sin licencia**. Antes de 2026.6 Core solo permitía una sesión llamada `default` y no enviaba media. Si alguien encuentra documentación vieja (blogs, tutoriales) que dice "multi-sesión requiere Plus", está desactualizada. Hay que **fijar una versión ≥ 2026.6.1** en el docker-compose.

## 2. Engines

| Engine | Cómo funciona | Notas |
|---|---|---|
| `WEBJS` (default) | Chromium real vía Puppeteer (WhatsApp Web) | Usa más CPU/RAM. Es el único con `message.waiting`. |
| `WPP` | Chromium vía Puppeteer (WPPConnect) | Parecido a WEBJS. |
| `NOWEB` | WebSocket en Node.js, sin navegador | Hay que activar el "store" (`config.noweb.store.enabled=true`) para listar chats/mensajes. Las reacciones llegan solo por `message.reaction`. |
| `GOWS` | WebSocket en Go, sin navegador | "Future replacement for NOWEB". Es el más liviano. Tiene los estados de passkey. |

- Se selecciona con `WHATSAPP_DEFAULT_ENGINE=WEBJS|WPP|NOWEB|GOWS`.
- Tags Docker: `devlikeapro/waha:latest` (Chromium), `:chrome` (soporta video), `:noweb`, `:gows`, `:arm`, `:noweb-arm`.
- sendSeen, typing, envío de imagen/archivo/voz están soportados en los 4 engines (según la tabla de features).
- **Gotcha:** el payload de webhooks y el campo `_data` cambian entre engines. Hay que elegir uno y probar antes de cambiarlo. **Recomendación para Conexa: `GOWS`** (sin navegador, más sesiones por servidor). Plan B: `WEBJS`.

## 3. Autenticación y seguridad

- La API key se envía en el header **`X-Api-Key`** en cada request (si es inválida, responde 401). El securityScheme de la OpenAPI es `api_key` en el header `X-Api-Key`.
- Variable de entorno: `WAHA_API_KEY`. Se recomienda guardarla hasheada: `WAHA_API_KEY=sha512:<hex>`.
- **Si no se configuran secretos, WAHA genera unos aleatorios al arrancar y los imprime en el log.**
- Dashboard: `WAHA_DASHBOARD_USERNAME`, `WAHA_DASHBOARD_PASSWORD` y `WAHA_DASHBOARD_ENABLED`. Swagger: `WHATSAPP_SWAGGER_USERNAME`, `WHATSAPP_SWAGGER_PASSWORD` y `WHATSAPP_SWAGGER_ENABLED` (estos solo protegen el panel, no la API).
- Keys API (`POST/GET/PUT/DELETE /api/keys`):
  - Las keys de admin acceden a todas las sesiones.
  - Las keys de sesión pueden restringirse con `actions` (`read`, `send`, `control`, `setting`, `app`, `delete`).
  - `POST /api/keys/media` crea una key **solo de descarga de media** y `POST /api/keys/control` una key de control (por ejemplo, para ver el QR). Sirven para no exponer la key de admin en el navegador.
- Excepciones: `WAHA_API_KEY_EXCLUDE_PATH` (por ejemplo `health,ping`) y `WHATSAPP_API_KEY_EXCLUDE_PATH=api/files/(.*)` (para abrir la media sin key; no se recomienda).
- La documentación recomienda: no exponer WAHA a internet, ponerlo detrás de un reverse proxy con HTTPS (el HTTPS integrado está deprecado), usar firewall y activar HMAC en los webhooks.

## 4. Ciclo de vida de la sesión

Estados (`SessionDTO.status`): `STOPPED`, `STARTING`, `SCAN_QR_CODE`, `WORKING`, `FAILED`, más `PASSKEY_REQUIRED` y `PASSKEY_CONFIRMATION_REQUIRED` (solo GOWS, cuando la cuenta usa passkey).

```
crear(start:true) → STARTING → SCAN_QR_CODE ──escaneo──→ WORKING
                                   │ (6 QR sin escanear)
                                   └──────────→ FAILED → restart / logout+start
stop → STOPPED      logout → borra la auth y, si estaba corriendo, vuelve a SCAN_QR_CODE
```

| Acción | Endpoint | Semántica |
|---|---|---|
| Crear | `POST /api/sessions` | `{name, start, config}`. Si se envía `start:false`, queda en `STOPPED`. Si se omite `name`, se genera automáticamente. |
| Listar / ver | `GET /api/sessions`, `GET /api/sessions/{session}` | Devuelve `status`, `me` (cuenta vinculada), `config` y `timestamps`. |
| Actualizar | `PUT /api/sessions/{session}` | Cambia la config (webhooks, metadata). |
| Iniciar | `POST /api/sessions/{session}/start` | Idempotente. |
| Detener | `POST /api/sessions/{session}/stop` | No desvincula ni borra nada. |
| Reiniciar | `POST /api/sessions/{session}/restart` | |
| Logout | `POST /api/sessions/{session}/logout` | Borra la autenticación y conserva la config. Si estaba corriendo, reinicia desde cero (nuevo QR). |
| Borrar | `DELETE /api/sessions/{session}` | Hace stop, logout y borra config y datos. Idempotente. |
| Info cuenta | `GET /api/sessions/{session}/me` | |
| Cuota de chats nuevos | `GET /api/sessions/{session}/capping` | `cappingStatus`: `NONE`, `FIRST_WARNING`, `SECOND_WARNING` o `CAPPED`, con `totalQuota` y `usedQuota`. Los cambios también llegan por `session.status`. |

Ejemplo de creación para un canal de Conexa:

```json
POST /api/sessions
{
  "name": "conexa-ventas-01",
  "start": true,
  "config": {
    "metadata": { "conexa.channel_id": "c0a8…", "conexa.org_id": "…" },
    "webhooks": [{
      "url": "https://conexa.example.com/api/webhooks/waha",
      "events": ["message", "message.any", "message.ack", "message.reaction", "message.revoked", "message.edited", "session.status"],
      "hmac": { "key": "<secreto-por-canal>" },
      "retries": { "policy": "exponential", "delaySeconds": 2, "attempts": 15 },
      "customHeaders": [{ "name": "X-Conexa-Channel", "value": "c0a8…" }]
    }]
  }
}
```

`metadata` se devuelve en **todos los webhooks**, así que sirve para mapear la sesión al `channel_id` de Conexa sin hacer una consulta.

- Persistencia: hay que montar el volumen `/app/.sessions` (o usar PostgreSQL con `WHATSAPP_SESSIONS_POSTGRESQL_URL`). Por defecto, al reiniciar el worker se relanzan las sesiones que estaban corriendo; para desactivarlo, `WAHA_WORKER_RESTART_SESSIONS=False`.
- Si una sesión queda en `FAILED`, primero hay que intentar `restart`; si no funciona, `logout` y luego `start`.

### Obtener el QR

- `GET /api/{session}/auth/qr?format=image`: devuelve un PNG binario (default).
- Con `Accept: application/json` devuelve `{ "mimetype": "image/png", "data": "<base64>" }`.
- Con `?format=raw` devuelve `{ "value": "2@AbC…" }`, para renderizar el QR en el frontend (por ejemplo con `qrcode.react`).
- **Expiración:** el primer QR dura **60 s** y los siguientes **20 s** cada uno, hasta **6 QR**. Después la sesión pasa a `FAILED`.
- Patrón: cada vez que llegue `session.status = SCAN_QR_CODE`, refrescar el QR (o hacer polling cada ~5 s mientras el modal esté abierto).
- Alternativa: código de emparejamiento con `POST /api/{session}/auth/request-code` y body `{"phoneNumber":"573001234567"}`. Devuelve un `code` para escribir en el teléfono. Según la documentación "no siempre está disponible", así que hay que dejar el QR como fallback.
- Para no exponer la key de admin al navegador de un agente, usar `POST /api/keys/control` o proxiar el QR por el backend de Conexa (recomendado).

## 5. Enviar mensajes

Todos son `POST` con `session` en el body. `chatId` es obligatorio.

**Texto:** `POST /api/sendText`
```json
{ "session": "conexa-ventas-01", "chatId": "573001234567@c.us", "text": "Hola, ¿en qué te ayudamos?", "reply_to": null, "linkPreview": true }
```
- `reply_to` acepta un id de mensaje (`false_573…@c.us_AAAA…`) para citarlo.
- `id` (opcional) acepta un id pre-generado con `GET /api/{session}/new-message-id`. **Esto es útil para Conexa:** se genera el id, se guarda en BD como `external_id` y luego se envía. Así el `message.any`/`message.ack` que vuelve siempre se puede correlacionar.

**Imagen:** `POST /api/sendImage`
```json
{ "session": "…", "chatId": "573…@c.us", "caption": "Plano del apto 502",
  "file": { "mimetype": "image/jpeg", "filename": "plano.jpg", "url": "https://…/signed-url" } }
```
`file` puede ser `RemoteFile` (`url`, más `mimetype` obligatorio) o `BinaryFile` (`data` en base64). Para Conexa conviene usar la URL firmada de Supabase Storage.

**Archivo / documento:** `POST /api/sendFile`. Mismo shape que la imagen (`file`, `caption`).

**Voz (nota de voz):** `POST /api/sendVoice`
```json
{ "session": "…", "chatId": "…", "convert": true,
  "file": { "mimetype": "audio/ogg; codecs=opus", "url": "https://…/nota.webm" } }
```
`convert: true` usa ffmpeg para convertir el audio a OGG/Opus. Hay que activarlo si grabamos en el navegador (webm).

Otros: `POST /api/sendVideo` (en WEBJS requiere la imagen `:chrome`), `sendLocation`, `sendContactVcard`, `sendPoll` y `PUT /api/reaction` con `{session, messageId, reaction:"👍"}`. Para editar un mensaje: `PUT /api/{session}/chats/{chatId}/messages/{messageId}`. Para borrarlo: `DELETE …/messages/{messageId}`.

**Marcar como leído:** `POST /api/sendSeen`
```json
{ "session": "…", "chatId": "573…@c.us", "messageIds": ["false_573…@c.us_AAAA…"] }
```
(`participant` solo aplica en NOWEB para grupos.) Alternativa: `POST /api/{session}/chats/{chatId}/messages/read`.

**Escribiendo…:** `POST /api/startTyping` y `POST /api/stopTyping` con `{session, chatId}`.

**Verificar número:** `GET /api/contacts/check-exists?phone=573001234567&session=…`.

**Historial:** `GET /api/{session}/chats/{chatId}/messages?limit=50&downloadMedia=false&merge=true` (`merge` une los chats `@lid` y `@c.us` del mismo contacto). También `GET /api/{session}/chats/overview` para la vista de chats.

## 6. Webhooks

### Configuración
- Por sesión: `config.webhooks[]` con `url`, `events`, `hmac.key`, `retries {policy: constant|linear|exponential, delaySeconds, attempts}` y `customHeaders`.
- Global: `WHATSAPP_HOOK_URL`, `WHATSAPP_HOOK_EVENTS` (separados por coma; `*` = todos, no recomendado en producción), `WHATSAPP_HOOK_HMAC_KEY`, `WHATSAPP_HOOK_RETRIES_*` y `WHATSAPP_HOOK_CUSTOM_HEADERS`. La config global no aparece en `session.config`.

### Headers de cada request
- `X-Webhook-Request-Id`: id único por request. **Usarlo (o `body.id`) para idempotencia.**
- `X-Webhook-Timestamp`: ms epoch.
- `X-Webhook-Hmac` y `X-Webhook-Hmac-Algorithm` (= `sha512`): solo se envían si se configuró `hmac`.

### Verificación HMAC
HMAC-SHA512 del **raw body** con la key configurada. El valor de ejemplo está en hex. En Next.js hay que leer el body crudo (`await req.text()`) antes de parsearlo:

```ts
import crypto from "node:crypto";
const raw = await req.text();
const expected = crypto.createHmac("sha512", key).update(raw).digest("hex");
const got = req.headers.get("x-webhook-hmac") ?? "";
const ok = got.length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
```

Además, conviene rechazar los requests con un `X-Webhook-Timestamp` muy viejo (por ejemplo, más de 5 min) para mitigar replays.

### Envelope común
```json
{ "id": "evt_01…", "timestamp": 1741249702485, "event": "message",
  "session": "conexa-ventas-01", "metadata": { "conexa.channel_id": "…" },
  "engine": "GOWS", "me": { "id": "573009998877@c.us", "pushName": "Inmobiliaria" },
  "payload": { … }, "environment": { … } }
```

### Eventos que necesita Conexa

| Evento | Cuándo | Campos clave del `payload` |
|---|---|---|
| `message` | Mensaje **entrante** (no incluye los propios) | `id`, `timestamp` (s), `from`, `fromMe`=false, `to`, `participant` (grupos), `body`, `hasMedia`, `media{url,mimetype,filename,error}`, `replyTo{id,body}`, `location`, `vCards`, `_data` |
| `message.any` | **Todos** los mensajes creados, incluidos los propios (enviados desde la API o desde el teléfono) | Mismo payload que `message`, más `source`: `api` o `app`. Sirve para capturar las respuestas que el agente escribe directamente desde el celular. |
| `message.ack` | Cambio de estado de entrega | `id`, `from`, `to`, `participant`, `fromMe`, `ack`, `ackName` |
| `message.ack.group` | ACK en grupos (evento aparte) | Igual |
| `message.reaction` | Alguien reacciona (también nosotros) | `id` (de la reacción), `from`, `fromMe`, `reaction.text` (emoji; `""` = reacción quitada), `reaction.messageId` (mensaje reaccionado) |
| `message.revoked` | Un mensaje fue borrado "para todos" | `revokedMessageId`, `after` (WAMessage de la acción), `before` (normalmente `null`) |
| `message.edited` | Mensaje editado | WAMessage más `editedMessageId` |
| `session.status` | Cambio de estado de la sesión | `name`, `status`, `statuses[]` (los últimos 3, con timestamp), `data` (passkey) |

Valores de `ack`: `-1 ERROR`, `0 PENDING`, `1 SERVER` (un check), `2 DEVICE` (dos checks), `3 READ` (dos checks azules), `4 PLAYED` (audio/video reproducido).

Ejemplo de `message` con media:
```json
{ "event": "message", "session": "conexa-ventas-01",
  "payload": {
    "id": "false_573001234567@c.us_3EB0ABCD1234",
    "timestamp": 1762700000, "from": "573001234567@c.us", "fromMe": false,
    "to": "573009998877@c.us", "body": "Adjunto la cédula",
    "hasMedia": true,
    "media": { "url": "https://waha.internal/api/files/conexa-ventas-01/3EB0ABCD1234.jpeg",
               "mimetype": "image/jpeg", "filename": null, "error": null },
    "ack": 1, "ackName": "SERVER" } }
```

**Gotchas de eventos:**
- En `message.edited` y `message.revoked`, `payload.id` es el id de la *acción*, no del mensaje original. El original está en `editedMessageId` / `revokedMessageId`.
- Si nos suscribimos a `message` **y** a `message.any`, los entrantes llegan dos veces. Opciones: suscribirse solo a `message.any` y separar por `fromMe`, o deduplicar por `payload.id`. **Recomendación: solo `message.any`, más un upsert por `(channel_id, external_id)`.**
- En NOWEB las reacciones no llegan por `message` ni por `message.any`.
- Los timestamps del envelope están en **ms** y los del payload (`payload.timestamp`) en **segundos**.

## 7. Media entrante

- WAHA descarga la media y la sirve en `media.url` (`/api/files/...`). **Esa URL exige `X-Api-Key`.** Conexa debe descargarla desde el backend y subirla a Supabase Storage en el handler del webhook.
- **Por defecto los archivos viven solo 180 segundos** (`WHATSAPP_FILES_LIFETIME`). Hay que copiarlos de inmediato, o poner `WHATSAPP_FILES_LIFETIME=0` con un volumen `/app/.media` y luego limpiarlo, o usar S3 (`WAHA_MEDIA_STORAGE=S3` con `WAHA_S3_BUCKET`, `WAHA_S3_REGION`, `WAHA_S3_ENDPOINT`, etc.; compatible con Supabase Storage S3 o R2).
- Si `hasMedia=true` pero `media.url=null`, la descarga se omitió por la configuración. Si `media.error` no es null, falló.
- Control de descarga: `WAHA_EVENTS_DOWNLOAD_MEDIA` y `WAHA_EVENTS_DOWNLOAD_MEDIA_MIMETYPES`.
- `WAHA_BASE_URL` define el host que aparece en `media.url` (por ejemplo, el hostname interno de la red docker).

## 8. Formatos de chatId

| Sufijo | Significado | Ejemplo |
|---|---|---|
| `@c.us` | Usuario (número internacional sin `+`) | `573001234567@c.us` |
| `@lid` | "Linked ID", un identificador oculto del usuario. WhatsApp lo usa cada vez más en lugar del número, sobre todo en grupos y en cuentas con privacidad de número. | `123456789012345@lid` |
| `@g.us` | Grupo | `120363012345678901@g.us` |
| `@newsletter` | Canal | |
| `status@broadcast` | Estados | Ignorar (`config.ignore.status=true`) |
| `@s.whatsapp.net` | Formato interno en `_data` (GOWS/NOWEB) | No usarlo para enviar; convertirlo a `@c.us` |

**Resolución de LID → teléfono:**
- `GET /api/{session}/lids/{lid}` devuelve el número.
- `GET /api/{session}/lids/pn/{phoneNumber}` hace lo inverso.
- `GET /api/{session}/lids` lista todos los mapeos.

**Implicación de diseño:** un contacto de Conexa puede tener dos identificadores (`wa_phone` y `wa_lid`). El matching de contactos debe aceptar ambos y normalizar a teléfono E.164 cuando el LID se pueda resolver. En Conexa deberíamos ignorar los grupos (`config.ignore.groups=true`) salvo que se decida lo contrario.

## 9. Despliegue (docker-compose mínimo)

```yaml
services:
  waha:
    image: devlikeapro/waha:gows   # fijar el tag de versión >= 2026.6.1 en producción
    restart: unless-stopped
    environment:
      WHATSAPP_DEFAULT_ENGINE: GOWS
      WAHA_API_KEY: sha512:<hash>
      WAHA_DASHBOARD_USERNAME: admin
      WAHA_DASHBOARD_PASSWORD: <pwd>
      WHATSAPP_SWAGGER_USERNAME: admin
      WHATSAPP_SWAGGER_PASSWORD: <pwd>
      WAHA_BASE_URL: https://waha.conexa.internal
      WHATSAPP_FILES_LIFETIME: "0"
      WHATSAPP_SESSIONS_POSTGRESQL_URL: postgres://…   # opcional
      WHATSAPP_HOOK_EVENTS: ""   # preferimos la config por sesión
    volumes:
      - ./waha/sessions:/app/.sessions
      - ./waha/media:/app/.media
    ports: ["127.0.0.1:3000:3000"]   # solo detrás de un reverse proxy con TLS
```

Puerto por defecto: 3000. Para monitoreo: `GET /ping`, `GET /health` y `GET /api/server/version`.

## 10. Riesgos

- **Términos de servicio:** WAHA automatiza una cuenta de consumidor o Business App mediante el protocolo de WhatsApp Web. **No es una API oficial de Meta.** Su uso puede violar los Términos de WhatsApp y Meta puede banear el número sin aviso ni apelación garantizada. No hay SLA ni soporte de Meta.
- **Baneo y restricciones:** la documentación de WAHA advierte:
  - **No iniciar conversaciones**: esperar a que el cliente escriba primero (por ejemplo, con links `wa.me`).
  - Simular el comportamiento humano: seen → typing (con duración proporcional al largo) → envío.
  - Usar retardos aleatorios y no hacer envíos masivos.
  - Si aparecen los errores **463** (shadow-restricted) o **475** (capped), **NO hacer restart, logout ni re-pair**; hay que pausar.
  - Ser marcado como spam "5-10 veces" lleva al baneo.
- **Fragilidad:** los cambios de WhatsApp Web pueden romper un engine de un día para otro. Hay que fijar versiones y tener un plan para cambiar de engine.
- **Dependencia del teléfono:** la sesión vinculada se cae si el teléfono queda mucho tiempo sin conexión o si alguien cierra las sesiones vinculadas desde el celular. Conexa debe alertar ante `session.status != WORKING`.
- **Datos personales:** la media pasa por nuestro servidor. Hay que tenerlo en cuenta en la política de tratamiento de datos (Ley 1581 de 2012, Colombia).
- **Mitigación recomendada:** usar WAHA para números operativos de soporte, donde el cliente siempre inicia la conversación. Mantener el canal oficial (Cloud API, ya en wacrm) para las notificaciones salientes con plantillas y para los números críticos de marca. En el modelo de datos, tratar `whatsapp_cloud` y `whatsapp_waha` como dos `channel_type` distintos.

## 11. Tabla: operación Conexa → endpoint WAHA

| Operación Conexa | Endpoint WAHA | Notas |
|---|---|---|
| Crear canal WhatsApp (QR) | `POST /api/sessions` | `start:true`, webhooks con HMAC, `metadata.channel_id` |
| Mostrar QR al admin | `GET /api/{session}/auth/qr?format=raw` (o `image`) | Refrescar cuando llegue `SCAN_QR_CODE`; expira a los 60/20 s |
| Vincular por código | `POST /api/{session}/auth/request-code` | Fallback |
| Estado del canal | `GET /api/sessions/{session}` y webhook `session.status` | |
| Pausar canal | `POST /api/sessions/{session}/stop` | |
| Reanudar canal | `POST /api/sessions/{session}/start` | |
| Reiniciar canal (FAILED) | `POST /api/sessions/{session}/restart` | |
| Desvincular número | `POST /api/sessions/{session}/logout` | Conserva la config |
| Eliminar canal | `DELETE /api/sessions/{session}` | |
| Cambiar webhook o metadata | `PUT /api/sessions/{session}` | |
| Cuota y riesgo del número | `GET /api/sessions/{session}/capping` | Mostrarlo en la salud del canal |
| Pre-generar id de mensaje | `GET /api/{session}/new-message-id` | Para correlacionar |
| Responder texto | `POST /api/sendText` | `reply_to` para citar |
| Enviar imagen | `POST /api/sendImage` | `file.url` firmada |
| Enviar documento | `POST /api/sendFile` | |
| Enviar nota de voz | `POST /api/sendVoice` | `convert:true` |
| Enviar video | `POST /api/sendVideo` | |
| Reaccionar | `PUT /api/reaction` | |
| Editar mensaje | `PUT /api/{session}/chats/{chatId}/messages/{messageId}` | |
| Borrar mensaje | `DELETE /api/{session}/chats/{chatId}/messages/{messageId}` | |
| Marcar leído | `POST /api/sendSeen` | Al abrir la conversación |
| Indicador "escribiendo" | `POST /api/startTyping` / `POST /api/stopTyping` | |
| Validar número | `GET /api/contacts/check-exists` | |
| Resolver LID | `GET /api/{session}/lids/{lid}` | |
| Importar historial | `GET /api/{session}/chats/{chatId}/messages` | `merge=true` |
| Listar chats (backfill) | `GET /api/{session}/chats/overview` | |
| Foto de perfil | `GET /api/{session}/chats/{chatId}/picture` | |
| Recibir mensajes | Webhook `message.any` (o `message`) | Separar por `fromMe` |
| Estado de entrega | Webhook `message.ack` | -1…4 |
| Reacciones | Webhook `message.reaction` | |
| Borrado o edición | Webhooks `message.revoked` y `message.edited` | |
| Descargar media entrante | `GET {media.url}` con `X-Api-Key` | Dentro de los 180 s por defecto |
| Healthcheck | `GET /health`, `GET /ping` | |
