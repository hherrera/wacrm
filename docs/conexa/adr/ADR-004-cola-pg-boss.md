# ADR-004 · Trabajos asíncronos con pg-boss

- Estado: **propuesto**

## Contexto
wacrm no tiene cola: usa `after()` (post-respuesta del webhook), dos endpoints cron disparados externamente y leases en tablas para broadcasts. Los envíos fallidos no se reintentan y los webhooks salientes se intentan una sola vez. Conexa añade copia urgente de media WAHA (180 s), reconciliación de Mailgun, salud de canales, y luego transcripciones y SLA.

## Opciones
| Opción | Notas |
|---|---|
| Seguir con `after()` + cron | Sin reintentos ni visibilidad |
| BullMQ | Requiere Redis (otro servicio) |
| **pg-boss** | Cola sobre el mismo Postgres: transaccional con los datos, reintentos/backoff, cron, sin infraestructura nueva |

## Decisión
pg-boss en `apps/api` (proceso `worker.ts` separado del HTTP, mismo código). Jobs y crons listados en [spec 01 §6](../spec/01-arquitectura-objetivo.md).

## Consecuencias
- Necesita conexión Postgres directa o pooler en modo sesión.
- Si el volumen crece mucho (transcripciones pesadas), se puede mover a BullMQ/Redis sin cambiar los handlers.
