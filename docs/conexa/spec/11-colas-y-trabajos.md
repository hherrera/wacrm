# 11 · Colas y trabajos en segundo plano

Decisión: [ADR-004](../adr/ADR-004-cola-pg-boss.md) — **pg-boss 12 sobre el Postgres de Supabase Cloud**, consumido por un proceso `worker` propio en el VPS. Sin Redis, sin servicios nuevos.

## 1. Por qué ahora y por qué así

Hoy (wacrm) no hay cola: el trabajo corre en `after()` dentro del webhook Meta (`webhook/route.ts:269`) o en dos endpoints cron que dispara un scheduler externo (`/api/automations/cron`, `/api/flows/cron`). No hay reintentos de envío, los webhooks salientes se intentan una vez y un fallo a mitad de `after()` pierde trabajo sin dejar rastro. WAHA y Mailgun añaden más webhooks y trabajos con plazo (la media de WAHA se borra a los 180 s).

| Opción evaluada | Veredicto |
|---|---|
| Seguir con `after()` + cron | ❌ sin reintentos, sin visibilidad, atado al ciclo de vida de la request |
| Tabla `jobs` propia + `pg_cron` | ❌ habría que construir reclamación con `SKIP LOCKED`, reintentos, backoff, DLQ, orden por clave… es reescribir pg-boss |
| `pgmq` (Supabase Queues) | ⚠️ nativo en Supabase y encolable desde SQL, pero sólo da *send/read/archive* con *visibility timeout*: reintentos con backoff, DLQ, cron, orden FIFO por clave y límites de concurrencia hay que programarlos a mano |
| BullMQ + Redis | ❌ servicio extra que operar y respaldar; el trabajo no es transaccional con los datos |
| **pg-boss 12** | ✅ librería Node sobre el mismo Postgres: encolar **dentro de la transacción de Drizzle** (adaptador incluido), reintentos con backoff exponencial, *dead letter queues*, cron, prioridad, política **`key_strict_fifo`** (orden estricto por clave), **concurrencia por grupo** (límite por canal), LISTEN/NOTIFY para baja latencia, dashboard (`@pg-boss/dashboard`) |

## 2. Topología

```
         Supabase Cloud (Postgres)
         ├─ esquema public   (datos de Conexa)
         └─ esquema pgboss   (colas, jobs, schedules)   ← creado/migrado por pg-boss
                ▲                         ▲
   transacción  │ send()                  │ fetch (SKIP LOCKED) + LISTEN/NOTIFY
                │                         │
        apps/api (HTTP)            apps/api worker (mismo código, `node dist/worker.js`)
        - webhooks → inbound_events + send()       - handlers por cola
        - POST /messages → message 'queued' + send() - schedules (cron)
```

- **Mismo código, dos procesos**: `server.ts` (HTTP) y `worker.ts` (consumidores + schedules). El contenedor `worker` se escala con réplicas; los límites por grupo (`groupConcurrency`) son globales entre réplicas.
- **Conexiones a Supabase Cloud**:
  - Worker: *Supavisor* en **modo sesión** (puerto 5432 del pooler) — conexión estable, necesaria para LISTEN/NOTIFY. Pool pequeño (≤ 10). Variable `WORKER_DATABASE_URL` (si falta, usa `DATABASE_URL`).
  - API HTTP (Drizzle): pooler en **modo transacción** (6543) con `prepare: false`; `withUser()` usa `SET LOCAL` dentro de la transacción, compatible con ese modo. El `send()` de pg-boss se ejecuta en esa misma transacción.
  - ⚠️ Verificar en el entorno real que LISTEN/NOTIFY funciona por el pooler en modo sesión; si no, pg-boss cae a *polling* (configurable, ~1–2 s), aceptable para el MVP.
- **Migraciones del esquema `pgboss`**: las gestiona pg-boss (`boss.start()` con `migrate: true` sólo en el worker, o su CLI en el pipeline de deploy). Fuera de `packages/db/supabase/migrations`.

## 3. Patrones obligatorios

1. **Webhook entrante** (Meta, WAHA, Mailgun, luego FreePBX): verificar firma → **una transacción**: `INSERT inbound_events … ON CONFLICT (provider, dedupe_key) DO NOTHING` + si insertó, `send('inbound.ingest', { eventId })` → responder 200. Nada de lógica de negocio en el request. Duplicados del proveedor = no-op.
2. **Envío saliente** (UI, API pública, automations, flows, IA, broadcasts): **una transacción**: `INSERT messages (status='queued')` + `send('outbound.send', { messageId }, { singletonKey: conversationId, group: { id: channelId } })` → 202 con el mensaje. El worker llama al adaptador del canal y actualiza `status`; la UI se entera por Realtime. Un único camino de salida, ordenado por conversación y con reintentos.
3. **Idempotencia de handlers**: todo handler debe tolerar re-ejecución (pg-boss garantiza *at-least-once*). Claves: `inbound_events.status`, `messages.message_id` (`external_id` en la API), estados monotónicos.
4. **Errores**: lanzar = reintento. Errores permanentes (firma, 4xx del proveedor por destinatario inválido, ventana 24 h cerrada) → marcar resultado y **terminar sin lanzar** (no reintentar lo irrecuperable).
5. **DLQ**: cada cola crítica tiene `deadLetter`. Un handler de DLQ marca el recurso (`messages.status='failed'`, `inbound_events.status='failed'`) y crea una notificación a admins.

## 4. Catálogo de colas (MVP)

| Cola | Payload | Política / clave | Concurrencia | Reintentos | DLQ | Notas |
|---|---|---|---|---|---|---|
| `inbound.ingest` | `{eventId}` | `key_strict_fifo`, clave `channelId:remitente` | 10 | 5, backoff, máx 60 s | `inbound.dead` | Parseo normalizado → contacto/conversación/mensaje. FIFO por remitente evita carreras al crear contacto/conversación |
| `inbound.process` | `{messageId}` | `key_strict_fifo`, clave `conversationId` | 10 | 3, backoff | `inbound.dead` | Flows → automations → IA → webhooks salientes. Para audios espera la transcripción (ver [12](12-multimedia-transcripciones.md)) |
| `outbound.send` | `{messageId}` | `key_strict_fifo`, clave `conversationId`; `group = channelId` | `groupConcurrency`: WAHA 1, Cloud 10, Mailgun 5 | 6, backoff, máx 5 min | `outbound.dead` | Mantiene orden por conversación; WAHA serializado por número (riesgo de baneo) |
| `media.mirror` | `{attachmentId, sourceUrl, channelId}` | `standard`, **prioridad alta** | 10 | 5, retraso corto (5 s) | `media.dead` | Copia media del proveedor a Storage. WAHA: plazo de 180 s (subir `WHATSAPP_FILES_LIFETIME`) |
| `media.transcribe` | `{attachmentId}` | `standard`; `group = accountId` | `groupConcurrency` 3 (costo/CPU) | 3, backoff | `media.dead` | Ver [12](12-multimedia-transcripciones.md) |
| `email.fetch_raw` | `{eventId}` | `standard` | 5 | 10, backoff, máx 1 h (Mailgun guarda ~3 días) | `inbound.dead` | Descarga el .eml crudo + parseado de Mailgun → Storage `email-raw` → `inbound.ingest` ([ADR-006](../adr/ADR-006-email-raw-primero.md)) |
| `status.apply` | `{eventId}` | `key_strict_fifo`, clave `externalId` | 10 | 5 | `inbound.dead` | Acks WA/WAHA y eventos Mailgun → `message_delivery_events` + estado monotónico |
| `webhooks.deliver` | `{endpointId, eventId}` | `standard` | 5 | 8, backoff, máx 1 h (≈ 24 h total) | `webhooks.dead` | Webhooks salientes a integraciones (hoy 1 intento) |
| `notify.user` | `{notificationId}` | `standard` | 5 | 3 | — | Email/escritorio para asignaciones y canales caídos |

### Programados (cron de pg-boss, política `exclusive` para no solaparse)
| Schedule | Frecuencia | Reemplaza / hace |
|---|---|---|
| `automations.tick` | cada minuto | `/api/automations/cron` (esperas, `time_based`) |
| `flows.tick` | cada minuto | `/api/flows/cron` |
| `channel.health` | cada minuto | Sesiones WAHA, token/registro de números Cloud, dominios Mailgun |
| `mailgun.reconcile` | cada 15 min | Events API para mensajes sin estado final |
| `maintenance.cleanup` | diario 03:00 (America/Bogota) | Purga `inbound_events` > 30 días (excepto email con .eml: retención documental, ADR-006), jobs archivados |
| *(post-MVP)* `sla.check`, `pbx.cdr.reconcile`, `call.transcribe` | — | Tickets y llamadas |

## 5. Operación y observabilidad
- **Dashboard** `@pg-boss/dashboard` montado sólo en red interna (o tras auth de admin) para ver colas, jobs fallidos, reintentar/redrive desde DLQ.
- `GET /health/queues` en la API: tamaño de cada cola y antigüedad del job más viejo → alerta si `inbound.ingest` o `outbound.send` superan 60 s de atraso.
- Logs de cada job con `jobId`, `queue`, `messageId`/`eventId` (pino), correlacionables con `inbound_events.id`.
- Cierre ordenado: `SIGTERM` → `boss.stop({ graceful: true })` espera a los jobs activos.

## 6. Implementación (etapa 0.2 / 0.4)
- 0.2: `apps/api/src/jobs/boss.ts` (instancia + conexión), `worker.ts` (registra handlers), un job real de prueba (`maintenance.cleanup`) y test de integración contra el Postgres local de Supabase.
- 0.4: colas `inbound.*`, `outbound.send`, `status.apply`, `webhooks.deliver`, schedules `automations.tick`/`flows.tick`; se eliminan `after()` del webhook y los endpoints cron de Next.
- Contratos de payload en `packages/shared` (zod), validados al encolar y al consumir.
