# Llamadas por WhatsApp Cloud API (Meta Calling API): investigación para Conexa

> Fecha de investigación: 2026-11-09. Las páginas de Meta se leyeron completas salvo donde se marca **[resumen]**: ahí la página venía truncada y el dato hay que confirmarlo antes de implementar.

**Decisión de alcance:** la **etapa 1** atiende las llamadas **en la misma interfaz web de Conexa** (WebRTC en el navegador del agente, señalización por Graph API). La opción **SIP → FreePBX** se evalúa en fases posteriores (ver §8).

Fuentes:
- Calling (visión general y changelog de calling): https://developers.facebook.com/documentation/business-messaging/whatsapp/calling
- Referencia de API y webhooks: https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/reference
- Ajustes de llamadas: https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/call-settings
- SIP: https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/sip/
- Precios: https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/pricing/ (no leída en detalle)
- Changelog de WhatsApp: https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog
- Versiones de Graph API: https://developers.facebook.com/docs/graph-api/changelog/versions
- Guía de versionado: https://developers.facebook.com/docs/graph-api/guides/versioning
- Anuncio v26.0: https://developers.facebook.com/blog/post/2026/07/29/introducing-graph-api-v26-and-marketing-api-v26/
- Anuncio v27.0: https://developers.facebook.com/blog/post/2026/11/04/introducing-graph-api-v27-and-marketing-api-v27/

---

## 1. Qué es

La Calling API está disponible desde el **15 de julio de 2025** (changelog de WhatsApp). Permite llamadas de voz VoIP entre un cliente de WhatsApp y un número de la empresa en Cloud API. **No** conecta con la red telefónica (PSTN).

- **Iniciadas por el usuario:** el cliente toca el ícono de llamada en el chat. Funcionan en todos los países donde hay Cloud API.
- **Iniciadas por la empresa:** requieren que el cliente haya dado **permiso** antes (§5). No están disponibles para números de empresa de EE. UU., Canadá, Egipto, Vietnam ni Nigeria. Colombia no aparece en esa lista.

## 2. Requisitos

- El número debe estar en Cloud API. No sirve en la app WhatsApp Business.
- El número debe tener un **límite diario de mensajes ≥ 2.000 destinatarios únicos**. Los números de prueba o sandbox están exentos, pero ahí las llamadas también vienen apagadas.
- La app debe estar suscrita al campo de webhook **`calls`**, además de `messages`, y tener el permiso `whatsapp_business_messaging`.
- Las llamadas vienen **apagadas** en cada número. Se activan con:
  ```http
  POST /{phone-number-id}/settings
  { "calling": { "status": "ENABLED" } }
  ```
  También se pueden activar en WhatsApp Manager → Account tools → Phone numbers → ⚙ → Calls.
- Los clientes de WhatsApp pueden tardar **hasta 7 días** en reflejar cambios de ajustes, como el ícono o el horario.

## 3. Webhooks

Las llamadas llegan por el campo **`calls`**, no por `messages`. Algunos tutoriales muestran un `messages[].type = "call"` con `status: "ringing"`, y es incorrecto.

```jsonc
{
  "object": "whatsapp_business_account",
  "entry": [{ "id": "<WABA_ID>", "changes": [{ "field": "calls", "value": {
    "messaging_product": "whatsapp",
    "metadata": { "display_phone_number": "...", "phone_number_id": "<PHONE_NUMBER_ID>" },
    "contacts": [{ "profile": { "name": "...", "username": "..." }, "wa_id": "...", "user_id": "<BSUID>" }],
    "calls": [{
      "id": "wacid....", "from": "...", "to": "...",
      "event": "connect", "timestamp": "1671644824",
      "direction": "USER_INITIATED",            // o BUSINESS_INITIATED
      "session": { "sdp_type": "offer", "sdp": "<SDP RFC 8866>" }
    }]
  }}]}]
}
```

| Evento (`calls[].event` o `statuses`) | Cuándo | Contenido |
|---|---|---|
| `connect` | Entra una llamada (o la empresa la inicia) | `id` (WACID) y `session` con el SDP |
| `statuses[]` con `type: "call"` | Cambio de estado | `RINGING`, `ACCEPTED` o `REJECTED` |
| `terminate` | Fin de la llamada | `status` (COMPLETED o FAILED), `start_time`, `end_time`, `duration`, `errors` |
| `call_recording_available` | Grabación lista (§6) | `call_recording.audio` con `id`, `sha256`, `mime_type` y `url` **[resumen]** |
| `call_transcription_available` | Transcripción de Meta lista (§6) | **[resumen]** |
| `call_created` | Solo en modo SIP | Sin SDP |

Por el campo `messages` llegan dos cosas relacionadas con llamadas:
- La respuesta al permiso: `interactive` con `type: call_permission_reply`.
- El **buzón de voz**: un mensaje `audio` cuyo `id` es el WACID de la llamada.

**Inconsistencia en la referencia de Meta:** la tabla dice que `connect` es "Business-initiated", pero el texto de la misma página dice que ese webhook entrega las llamadas entrantes. Además, en las tablas `sdp_type` aparece como `offer` y en los ejemplos como `answer`. Hay que validarlo con una llamada real en el número de prueba.

## 4. Señalización por Graph API (etapa 1: WebRTC)

Todo pasa por un solo endpoint: `POST /{phone-number-id}/calls`, con `"messaging_product": "whatsapp"`.

| `action` | Uso | Cuerpo |
|---|---|---|
| `pre_accept` | Recomendado antes de `accept`, para que no se corte el inicio del audio | `call_id` y `session` (respuesta SDP) |
| `accept` | Atender | Igual que `pre_accept`, más `biz_opaque_callback_data` (≤ 512 caracteres) y `recording` opcional |
| `reject` | Rechazar | `call_id` |
| `terminate` | Colgar | `call_id`. Meta pide enviarlo aunque el BYE ya haya salido por RTCP, para cobrar la duración exacta |
| `connect` | Llamada saliente | `to` y `session` (oferta SDP) |

- **Tiempo límite:** hay entre **30 y 60 s** desde el webhook `connect` para aceptar. Después, el cliente ve "No contestada" y llega un `terminate`.
- **Media:** ICE + DTLS-SRTP + **Opus 48 kHz** (siempre presente). Meta usa `a=ice-lite` con candidatos *host*, y las páginas leídas no mencionan STUN ni TURN. Desde el 23-03-2026 también hay G.711 (PCMA/PCMU), activable con `audio.additional_codecs`, pero agrega transcodificación y latencia.
- **El audio va directo entre el navegador del agente y Meta.** Ni `api` ni el servidor tocan el audio; solo transportan el SDP.

### Flujo de una llamada entrante en Conexa

```
Cliente ──llama──► Meta ──webhook calls/connect (SDP offer)──► api
api: guarda el evento crudo (inbound_events), crea el mensaje content_type='call' (estado: sonando)
api ──Supabase Realtime──► navegadores de los agentes elegibles: "llamada entrante"
Agente pulsa Atender:
  navegador: RTCPeerConnection.setRemoteDescription(offer) → createAnswer() → SDP answer
  navegador ──POST /v1/calls/{id}/accept (answer)──► api
  api ──pre_accept, luego accept──► Graph API /{phone-number-id}/calls
Audio: navegador ⇄ Meta (DTLS-SRTP/Opus)
Colgar: navegador → api → action=terminate.  Meta → webhook terminate → api cierra el mensaje (duración)
```

La primera respuesta válida gana: si dos agentes pulsan Atender, `api` acepta solo la primera y los demás reciben "ya atendida". Si nadie atiende a tiempo, `api` rechaza la llamada y Meta ofrece el buzón de voz o el permiso para devolverla.

## 5. Llamadas salientes y permisos

- Para que la empresa pueda llamar, el cliente tiene que aprobarlo. Hay dos formas:
  - Una solicitud de permiso, que se envía como mensaje interactivo y se cobra como mensaje.
  - De forma automática después de una llamada perdida o atendida, si `callback_permission_status = ENABLED`.
- **Límites:** el texto de producción habla de 1 solicitud de permiso por día y 2 por semana por par empresa–usuario. El changelog del 19-12-2025 dice que el límite de llamadas iniciadas por la empresa subió de 10 a 100 por día por usuario. No está claro si son límites distintos; **hay que verificarlo.**
- Dos llamadas seguidas sin contestar generan un aviso del sistema, y cuatro **revocan** el permiso.
- El endpoint de permisos admite 5 solicitudes por segundo **[resumen]**.

## 6. Grabación, transcripción y buzón de voz

- **Grabación:** Meta no graba por defecto. Se pide en cada llamada con un objeto `recording` en `accept` o `connect`:
  ```json
  "recording": { "status": "ENABLED", "purpose": "calidad del servicio", "announcement_language": "es_ES" }
  ```
  Meta anuncia el propósito a ambas partes. El archivo llega por `call_recording_available` y **se puede descargar durante 7 días**, así que hay que copiarlo a Storage con un job de pg-boss, igual que la media entrante (spec 12).
- **Transcripción de Meta:** se activa aparte, con el mismo formato que la grabación, y llega por `call_transcription_available`. Hay que compararla con `call.transcribe` propio (faster-whisper u OpenAI, spec 12) por idioma, costo y control.
- **Grabar del lado de Conexa:** con WebRTC el audio pasa por el navegador, así que también se podría grabar ahí con `MediaRecorder`. Esa grabación depende de que la pestaña siga abierta. La de Meta es más confiable.
- **Buzón de voz:** se puede recibir un mensaje de voz de 0 a 30 s cuando la llamada se rechaza o nadie contesta. El anuncio debe ser un OGG/Opus de menos de 60 s, subido con `use_case=call_voicemail_announcement`. Para usar el buzón, hay que desactivar el horario de llamadas.

## 7. Ajustes del número (`POST /{phone-number-id}/settings`, objeto `calling`)

| Ajuste | Para qué |
|---|---|
| `call_hours` | Horario de atención: `timezone_id`, `weekly_operating_hours` (como máximo 2 franjas por día, en formato `HHMM`) y `holiday_schedule` (hasta 20 fechas). Fuera de horario, el cliente ve la próxima franja disponible. **Si se omite `holiday_schedule`, se borra.** |
| `callback_permission_status` | Pedir permiso para devolver la llamada después de una perdida o atendida |
| `call_icon_visibility` | `DEFAULT` muestra el ícono en el chat; `DISABLE_ALL` lo oculta y solo deja los botones CTA de plantillas |
| `call_icons.restrict_to_user_countries` | Mostrar el ícono solo a números de ciertos países (p. ej. `["CO"]`) |
| `audio.additional_codecs` | Agregar G.711 |
| `sip` | Modo SIP (§8). **Excluye** la señalización por Graph API |

**Restricciones de Meta:** si hay muchas quejas, Meta puede pausar las llamadas 7 días (`RESTRICTED_USER_INITIATED_CALLING` o `RESTRICTED_BUSINESS_INITIATED_CALLING`). Si se contestan pocas llamadas, puede ocultar el botón. Por eso la tasa de llamadas atendidas en la etapa 1 importa.

## 8. Fases posteriores: SIP → FreePBX (por evaluar)

Esto queda fuera de la etapa 1. Lo que se sabe hasta ahora:

- **Configuración:** `calling.sip` con `status: ENABLED`, `webhook_delivery: ENABLED` y `servers: [{ hostname, port: 5061 }]`. Se admite **un servidor por número**.
- **Transporte y autenticación:** TLS obligatorio (Meta presenta un certificado de `wa.meta.vc`) y autenticación digest (407 con `Proxy-Authenticate`). La contraseña se obtiene con `GET /{id}/settings?include_sip_credentials=true`.
- **Media:** ICE + DTLS-SRTP, o SDES si se habilita explícitamente, con Opus o G.711.
- **Cabeceras que agrega Meta:** `x-wa-meta-wacid`, `x-wa-meta-phone-number-id`, `x-wa-meta-user-id` y `x-wa-meta-username`. En el BYE agrega `x-wa-meta-call-duration`.
- **Es excluyente.** Con SIP activo, el número **no** admite la Graph API de llamadas, así que no se puede tener atención web y PBX a la vez en el **mismo número**. Los mensajes de texto no se ven afectados.
- Meta publicó una guía para **Asterisk** el 29-09-2025 (`calling/integration-examples#asterisk-using-sip`); no se leyó. FreePBX no aparece en la documentación.
- **Ventaja:** se reusa el puente AMI de la spec 09, y la grabación y el CDR quedan en el PBX.
- **Costo:** el PBX tiene que soportar TLS, DTLS-SRTP, ICE y Opus.
- **El precio es el mismo:** SIP cambia la forma de señalizar, no la tarifa (fuente secundaria).

## 9. Versión de Graph API cableada en Conexa

### Estado actual

`v21.0` está escrita a mano en **dos** archivos, y cada uno tiene su propia constante:

| Archivo | Uso |
|---|---|
| `apps/web/src/lib/whatsapp/meta-api.ts:17` | Todo el cliente: `/messages`, `/register`, `subscribed_apps`, `phone_numbers`, `message_templates`, `uploads`, descarga de media y salud del número |
| `apps/web/src/app/api/whatsapp/templates/sync/route.ts:29` | Sincronización de plantillas (`/{waba_id}/message_templates`) |

### Calendario oficial (tabla de versiones de Graph API)

| Versión | Lanzada | Deja de funcionar |
|---|---|---|
| v20.0 | 2024-05-21 | 2026-09-24 (ya vencida) |
| **v21.0 (la nuestra)** | 2024-10-02 | **2027-01-21** |
| v22.0 | 2025-01-21 | 2027-05-20 |
| v23.0 | 2025-05-29 | 2027-10-08 |
| v24.0 | 2025-10-08 | 2028-02-18 |
| v25.0 | 2026-02-18 | 2028-07-29 |
| v26.0 | 2026-07-29 | por definir |
| **v27.0 (la más reciente)** | **2026-11-04** | por definir |

La regla de Meta: cada versión deja de funcionar dos años después de que sale la siguiente. Los anuncios de v26 y v27 confirman la baja de v21 el **21-01-2027, unas 10 semanas desde hoy**.

**Qué pasa al vencer.** La guía de versionado dice que las llamadas a una versión vencida "se dirigirán a la última versión anterior que funcione". Pero v19 y v20 ya vencieron, así que después del 21-01-2027 **no queda ninguna versión anterior a v21**, y Meta no documenta qué responde en ese caso. Algunos blogs dicen que la llamada se "sube" sola a una versión más nueva, pero eso contradice la regla oficial. **No hay que contar con eso: hay que migrar antes de la fecha.**

### Cambios entre v21 y v27 que podrían afectarnos (changelog de WhatsApp)

| Cambio | Versión | ¿Nos afecta? |
|---|---|---|
| Límites de mensajería por portafolio: `messaging_limit_tier` devuelve el límite del portafolio y aparece el campo `whatsapp_business_manager_messaging_limit` | v24.0+ | **No.** `getPhoneNumberHealth` ya pide `whatsapp_business_manager_messaging_limit` y tolera que falle |
| El webhook de estado ya no trae el objeto `conversation` (salvo dentro de una ventana Free Entry Point) | v24.0+ | **No.** El tipo `statuses[]` en `webhook/route.ts` no lee `conversation` ni `pricing` |
| Error 131059 en `message_templates` cuando el cursor es inválido | v24.0+ | Bajo. La sincronización pagina con cursor; hay que revisar que muestre el error |
| Error 132018 con diagnóstico al enviar plantillas | v23.0+ | Solo es un código nuevo; conviene agregarlo a `meta-error-explain.ts` |
| `package_name` y `signature_hash` obligatorios en plantillas de autenticación one-tap/zero-tap; `data_localization_region` eliminado de `/register` | v21.0 | No. Ya estamos en v21 y no usamos ninguno de los dos |
| Desde el 27-10-2026, en **todas** las versiones: dejan de funcionar `pretty`, `debug`, `date_format`, `GET /?ids=…` y ETag. Desde v27 se suman `method=`, alias de campos, `callback` y `asyncbatch` en apps nuevas | todas | **No.** No encontré ninguno de esos parámetros en el código |
| BSUID (`user_id`, `parent_user_id`) y `username` en `contacts` | sin versión | Ya está tipado en `webhook/route.ts` |
| `messaging_account_id` reemplaza a `paid_messaging_account_id` (fecha límite 31-12-2026) | sin confirmar | Solo lo menciona una fuente secundaria. El código no usa ninguno de los dos. **Verificar** |

**La Calling API no exige una versión mínima de Graph API:** los ejemplos de Meta usan rutas sin versión o `{VERSION}`. Aun así, conviene implementar llamadas ya sobre la versión nueva.

### Recomendación de versión

1. Subir **ambas** constantes a **`v25.0`** antes del 21-01-2027. v25 está estable desde febrero de 2026 y funciona hasta el 29-07-2028. Si se prefiere más margen, se puede subir a v27 y vigilar su changelog.
2. Unificar las dos constantes en una sola exportada desde `meta-api.ts`. Hoy la de `templates/sync/route.ts` está duplicada y puede quedarse atrás.
3. Cuando el webhook se mueva a `apps/api` (fase 0), usar esa misma constante, idealmente desde `packages/shared` o `apps/api`.
4. Probar en el número de prueba: envío de texto, media y plantilla, sincronización de plantillas, registro, salud del número y webhooks de estado.

## 10. Brecha con el código actual (etapa 1)

| Pieza | Estado | Qué falta |
|---|---|---|
| URL del webhook, verificación y firma | Existe (`apps/web/src/app/api/whatsapp/webhook/route.ts`; se mueve a `apps/api` en la fase 0) | Suscribir el campo `calls` en Meta |
| Enrutado por `change.field` | Solo separa plantillas; todo lo demás se trata como mensajería (`route.ts:320-345`) | Agregar la rama `field === 'calls'`. Sin ella, `calls[]` se ignora y sus `statuses` (`type: "call"`) caen en `handleStatusUpdate`, que espera estados de mensajes |
| `messages.content_type` | El CHECK de `010_flows.sql:62` no admite `'call'` | Migración 061: `'call'` y los metadatos (WACID, dirección, estado, duración, agente) |
| Cliente Graph API | `meta-api.ts` | `enableCalling`, `updateCallSettings`, `callAction(pre_accept, accept, reject, terminate)` y subir de versión (§9) |
| Tiempo real hacia los agentes | Supabase Realtime, que ya usa el inbox | Canal o evento de "llamada entrante" con un plazo menor a 30 s |
| UI de llamada | No existe | Aviso de llamada entrante, botones Atender/Rechazar/Colgar, `RTCPeerConnection`, permiso de micrófono y estado de la llamada |
| Endpoints de la api | No existen | `POST /v1/calls/:id/accept|reject|terminate`, con control de que solo el primer agente que acepte se quede con la llamada |
| Grabación | No existe | Job pg-boss que copie `call_recording_available` a Storage antes de que venzan los 7 días (spec 12) |
| Requisitos del número | Por confirmar | Límite ≥ 2.000 por día y llamadas activadas en cada número |

## 11. Riesgos y pendientes

- La **pestaña tiene que estar abierta**. Con WebRTC no hay timbre si el agente cerró el navegador; Push o la PWA quedan para después.
- **Redes corporativas:** Meta usa ICE-lite con candidatos host y no publica TURN. Hay que probar detrás de la red de la oficina; si UDP está bloqueado, puede no haber audio.
- **Contestar poco tiene consecuencias:** Meta puede ocultar el botón. Conviene usar `call_hours` y el buzón de voz desde el primer día.
- **Precios:** hay que leer la página oficial de precios. Según fuentes secundarias, las llamadas del usuario son gratis y las de la empresa se cobran por pulsos de 6 s según el país.
- **Pendientes de verificar:** la contradicción `connect`/`sdp_type` en la referencia, los límites de permisos (1/día contra 100/día), `messaging_account_id` y la guía de Asterisk.
