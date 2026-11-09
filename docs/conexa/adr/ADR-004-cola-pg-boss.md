# ADR-004 · Trabajos asíncronos con pg-boss

- Estado: **aceptado** (2026-11-09, definido como prioridad por el usuario)
- Detalle operativo: [spec 11 — Colas y trabajos](../spec/11-colas-y-trabajos.md)

## Contexto
wacrm no tiene cola: usa `after()` (post-respuesta del webhook), dos endpoints cron disparados externamente y leases en tablas para broadcasts. Los envíos fallidos no se reintentan y los webhooks salientes se intentan una sola vez. Conexa añade webhooks de WAHA y Mailgun, copia urgente de media (WAHA borra a los 180 s), transcripciones, salud de canales, reconciliación de Mailgun y luego SLA y llamadas. Infraestructura decidida: **Supabase Cloud** + VPS con Docker.

## Opciones
| Opción | Notas |
|---|---|
| Seguir con `after()` + cron | Sin reintentos ni visibilidad |
| Tabla `jobs` propia + `pg_cron` | Reimplementar reclamación, reintentos, DLQ, orden por clave |
| `pgmq` (Supabase Queues) | Primitivas básicas (send/read/archive + visibility timeout); el resto a mano |
| BullMQ + Redis | Servicio extra; no transaccional con los datos |
| **pg-boss 12** | Sobre el mismo Postgres; encola en la transacción de Drizzle; reintentos/backoff, DLQ, cron, `key_strict_fifo`, concurrencia por grupo, LISTEN/NOTIFY, dashboard |

## Decisión
pg-boss 12 en `apps/api`, proceso `worker` separado del HTTP (mismo código), esquema `pgboss` en el Postgres de Supabase Cloud. Patrones: webhook = persistir evento crudo + encolar en una transacción; todo envío saliente = mensaje `queued` + `outbound.send` FIFO por conversación y limitado por canal.

## Consecuencias
- Un único camino de entrada y uno de salida, ambos con reintentos, orden y trazabilidad.
- Sin infraestructura nueva; backups de Supabase incluyen el estado de las colas.
- El worker necesita conexión en modo sesión (Supavisor 5432); la API puede usar modo transacción.
- La carga de colas vive en la misma BD que los datos: vigilar con `/health/queues`. Si el volumen crece mucho (p. ej. transcripción masiva de llamadas), las colas pesadas pueden moverse a otro Postgres o a BullMQ sin cambiar los handlers.
