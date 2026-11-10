# ADR-002 · Canal como entidad + adaptadores + pipelines únicos

- Estado: **aceptado** (2026-11-10)

## Contexto
wacrm asume un número de WhatsApp por cuenta, una conversación por contacto e identidad por teléfono, y tiene 5 caminos de envío a Meta y el pipeline de ingesta incrustado en la ruta del webhook (ver [análisis 06](../analisis/06-mejoras-extensibilidad-multicanal.md)).

## Decisión
1. Tabla `channels` genérica (+ `channel_secrets`); toda conversación y mensaje lleva `channel_id`.
2. Conversación única por `(channel_id, contact_id, thread_key)`; `thread_key=''` en chat, Message-Id raíz en email.
3. `contact_identities` (phone, wa_bsuid, waha_lid, email) con un único resolver.
4. Interfaz `ChannelAdapter` (send, markRead, react + `capabilities`) con tres implementaciones en el MVP; registro como objeto literal.
5. Webhooks **fuera** de la interfaz: cada proveedor tiene su ruta (firma y formato distintos) y todas terminan en `ingestInbound()` / `ingestStatus()`.
6. Toda salida (UI, API pública, automations, flows, IA) pasa por `sendToConversation()`.

## Consecuencias
- Añadir un canal = migración de enum + adaptador + ruta de webhook + mapeo de capacidades.
- La UI se rige por capacidades, no por tipo de canal.
- Broadcasts siguen siendo específicos de WhatsApp Cloud (usan el adaptador para enviar).
