# ADR-005 · WhatsApp no oficial con WAHA

- Estado: **propuesto** (requiere aceptación formal del riesgo por el negocio)

## Contexto
Parte de la atención ocurre hoy en números de WhatsApp de celulares (App normal/Business) que no están en Cloud API. Se pide conectarlos por QR.

## Decisión
- WAHA self-hosted, imagen libre `devlikeapro/waha` **≥ 2026.6.1** (desde esa versión multi-sesión y media no requieren licencia Plus), tag fijado, motor GOWS.
- Una sesión WAHA por canal; nombre `cx_<id>`; `metadata.channel_id` en la sesión para enrutar webhooks.
- WAHA sólo accesible desde la red interna; `X-Api-Key` + HMAC SHA-512 en webhooks.
- Media entrante copiada a Storage de inmediato (o WAHA con almacenamiento S3).
- Prohibido broadcasts por WAHA; limitador por canal; pausa automática ante errores de restricción.

## Consecuencias
- Riesgo de bloqueo de números (ToS de WhatsApp) asumido conscientemente y documentado en la UI.
- Un servicio más que operar (sesiones, actualizaciones de WAHA cuando WhatsApp cambia su protocolo).
- Migrar un número de WAHA a Cloud API es posible sin perder historial (mismo contacto por identidad `phone`; nueva conversación en el canal nuevo).
