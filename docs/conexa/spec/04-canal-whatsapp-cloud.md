# 04 · F1 — WhatsApp Cloud API multi-número

## Objetivo
Conectar **N números** de WhatsApp Business Platform (Cloud API) a la cuenta: uno por línea de negocio (p. ej. Arriendos, Ventas, Cartera), de uno o varios WABA y una o varias Meta Apps.

## Estado actual (ver [02](../analisis/02-modelo-datos-y-canal-whatsapp.md))
- Funciona completo para **un** número: webhook HMAC, envío texto/media/plantillas/interactivos, reacciones, estados, espejo de media, gestión de plantillas, registro y suscripción de WABA, explicación de errores Meta.
- `META_APP_SECRET` ya acepta lista de secretos (varias Apps) — `docs/multi-waba.md`.
- Bloqueos: `UNIQUE(account_id)` en `whatsapp_config` y lecturas `.single()` por cuenta.

## Requisitos funcionales
| ID | Requisito |
|---|---|
| WC-1 | Admin crea un canal `whatsapp_cloud` con nombre, Phone Number ID, WABA ID, token (System User), verify token, PIN. Se reutiliza el flujo actual de verificación/registro/suscripción (`config/route.ts`) parametrizado por canal. |
| WC-2 | Listado de canales con estado (`connected/error`), calidad y límite de mensajería del número (`GET /{phone_number_id}?fields=quality_rating,messaging_limit_tier`), último error. |
| WC-3 | Entrante: el webhook enruta por `metadata.phone_number_id → channels.config.phone_number_id`. Conversación por (canal, contacto). |
| WC-4 | Saliente: se responde **siempre por el canal de la conversación**. Nueva conversación saliente (desde contacto o API) exige elegir canal (default: canal por defecto del equipo del usuario). |
| WC-5 | Plantillas **por WABA**: `message_templates.waba_id`; sincronizar/crear por WABA; el selector del composer muestra sólo las del WABA del canal. |
| WC-6 | Ventana 24 h validada **en servidor** usando `conversations.last_inbound_at`; fuera de ventana sólo plantillas (error `reply_window_closed`). |
| WC-7 | Broadcasts: elegir canal (número) emisor; el resto del módulo queda igual. Los mensajes de broadcast se registran también en `messages` (hoy no aparecen en el inbox). |
| WC-8 | Desconectar canal: deja de recibir/enviar; conversaciones quedan en solo-lectura. |
| WC-9 | Salud: job `channel.health` consulta cada canal (token válido, número registrado) y marca `error` con detalle; notifica a admins. |

## Diseño
- `channels/whatsapp-cloud/adapter.ts` implementa `ChannelAdapter` envolviendo `meta-api.ts` existente (texto, media, plantilla, botones, lista, reacción, `markRead`).
- `channels/whatsapp-cloud/webhook.ts`: GET verificación (busca verify token entre los canales cloud), POST firma → guarda `inbound_events` → parsea a `InboundEvent`/`StatusEvent` → `ingestInbound`/`ingestStatus`. Plantillas (`message_template_status_update`…) se enrutan por `entry.id` (WABA) como hoy.
- Capacidades: `templates, interactive, reactions, replyWindowHours: 24, voiceNotes, typing, readReceipts`, límites de media de Meta.
- Webhook URL: `https://<api>/webhooks/whatsapp-cloud` (única para todos los números/Apps).

## Contratos (packages/shared)
```ts
CreateWhatsappCloudChannel = { name, phoneNumberId, wabaId, accessToken, verifyToken, pin?, defaultTeamId? }
ChannelDTO = { id, type, name, address, status, statusDetail, capabilities, defaultTeamId, createdAt }
```

## Aceptación
1. Dos números de dos WABA distintos conectados; un mensaje a cada uno crea dos conversaciones distintas para el mismo contacto, cada una con badge de su canal.
2. Responder desde cada conversación sale por el número correcto (verificado en el teléfono del cliente).
3. Plantillas del WABA A no aparecen en conversaciones del número B.
4. Enviar texto libre con `last_inbound_at` > 24 h devuelve `reply_window_closed` desde la API (no sólo la UI).
5. Los tests portados de `lib/whatsapp/*` pasan en `apps/api`.
