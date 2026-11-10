# ADR-006 · Email: guardar el correo crudo (.eml) antes de parsear

- Estado: **aceptado** (2026-11-10; propuesto el 2026-11-09 a pedido del usuario)
- Afecta: [spec 07 — Email](../spec/07-canal-email-mailgun.md), [spec 03 — Modelo de datos](../spec/03-modelo-datos.md), [spec 11 — Colas](../spec/11-colas-y-trabajos.md)

## Contexto
La spec 07 recibía el correo con `forward()` de Mailgun: un POST con los campos **ya parseados por Mailgun**. Así nunca tenemos el correo original: si nuestro parseo falla, si cambiamos la lógica de hilos o si hace falta evidencia (cliente que dice "yo sí envié el contrato"), no hay de dónde reconstruir. Para el soporte de una inmobiliaria el correo es también **soporte documental** (contratos, comprobantes, reclamos con plazos legales).

Formas de recibir de Mailgun ([investigacion/mailgun.md](../investigacion/mailgun.md) §Routes):

| Opción | Original (MIME) | Texto sin citas de Mailgun | Correos grandes | Recepciones por correo |
|---|---|---|---|---|
| A. `forward(url)` | ❌ | ✅ | ⚠️ todo en el POST | 1 |
| B. `forward(url…mime)` | ✅ | ❌ (hay que hacer *quote stripping* propio) | ⚠️ todo en el POST | 1 |
| C. Dos `forward` (normal + mime) | ✅ | ✅ | ⚠️ doble | 2, hay que correlacionarlas |
| **D. `store(notify=url)`** | ✅ (descarga posterior) | ✅ (descarga posterior) | ✅ el aviso es liviano; el contenido se baja en un job | 1 aviso + descargas desde el worker |

## Decisión
**Opción D: "crudo primero".** La ruta de cada canal de email es `match_recipient(...)` → `store(notify="<api>/webhooks/mailgun/inbound")` → `stop()`.

### Flujo
```
Mailgun ──notify──► POST /webhooks/mailgun/inbound
                    1. verificar firma (HMAC-SHA256 timestamp+token)
                    2. TX: INSERT inbound_events (provider=mailgun, dedupe_key=storage key,
                           payload = aviso sin cuerpos, status=pending)
                         + send('email.fetch_raw', {eventId})
                    3. 200
worker: email.fetch_raw   (reintentos con backoff; Mailgun conserva el mensaje ~3 días)
                    4. GET message-url  Accept: message/rfc2822  → MIME crudo
                    5. subir a Storage privado  email-raw/account-<id>/<yyyy>/<mm>/<eventId>.eml
                       + sha256 + tamaño  → inbound_events.raw_*
                    6. GET message-url (JSON) → campos parseados de Mailgun (stripped-text,
                       stripped-html, message-headers, content-id-map) → guardar en
                       inbound_events.payload (sin adjuntos)
                    7. send('inbound.ingest', {eventId})
worker: inbound.ingest (email)
                    8. parsear el .eml con librería MIME (adjuntos, inline cid, charset, headers)
                       + usar stripped-text/html del snapshot de Mailgun para el cuerpo visible
                    9. hilo → contacto → conversación → messages + message_attachments
                       messages.inbound_event_id = eventId   (trazabilidad "ver original")
```

### Por qué
- **Reprocesable sin depender de Mailgun**: el `.eml` + el snapshot parseado quedan en nuestra infraestructura; `POST /admin/inbound-events/:id/reprocess` re-ejecuta el ingest (p. ej. tras corregir el algoritmo de hilos) aunque Mailgun ya haya borrado el mensaje.
- **Evidencia y auditoría**: original íntegro con todos los headers (`Received`, `Authentication-Results` con SPF/DKIM/DMARC), hash SHA-256 para demostrar integridad.
- **Robustez**: el webhook queda liviano (sin adjuntos grandes en el request, sin límite de body); la descarga pesada va a un job con reintentos y 3 días de margen.
- **Depuración**: casos raros de clientes de correo (Outlook, iPhone, reenvíos) se analizan sobre el original.
- **Exportación**: botón "descargar original (.eml)" para reenviar a otra área, adjuntar a un ticket o entregar a legal.

### Principio general (todos los canales)
"Crudo primero" ya aplica a WhatsApp/WAHA vía `inbound_events.payload` (el JSON del webhook **es** el crudo). Para email el crudo es el `.eml`, demasiado grande para `jsonb`, por eso va a Storage y `inbound_events` guarda la referencia. Mismo patrón servirá para grabaciones de llamadas.

## Cambios de modelo
```sql
ALTER TABLE inbound_events
  ADD COLUMN account_id uuid,
  ADD COLUMN raw_storage_path text,     -- email-raw/...eml
  ADD COLUMN raw_sha256 text,
  ADD COLUMN raw_size_bytes bigint,
  ADD COLUMN raw_fetched_at timestamptz;
ALTER TABLE messages ADD COLUMN inbound_event_id bigint REFERENCES inbound_events(id);
```
- Bucket **`email-raw` privado**, sin acceso para `authenticated`; descarga sólo vía API con rol `admin` o con permiso sobre la conversación, y siempre como `Content-Disposition: attachment` (nunca renderizado inline: puede contener HTML/scripts maliciosos).
- **Retención distinta**: `inbound_events` (fila) se purga a 30 días como estaba previsto **excepto** las de email con `.eml`, cuya fila y archivo se conservan según la política documental (propuesta: 5 años, a validar con legal). Job `maintenance.cleanup` respeta esa regla.

## Saliente: guardar también lo que enviamos (decidido 2026-11-10)
Para simetría y control del hilo: construir el MIME nosotros (p. ej. `MailComposer` de nodemailer) y enviarlo con `POST /v3/{domain}/messages.mime`. Ventajas: guardamos el `.eml` exacto enviado en `email-raw` (mismo esquema, `direction=out`) y **fijamos nuestro propio `Message-Id`** antes de enviar, lo que elimina la dependencia de esperar el `id` de respuesta de Mailgun para el hilo. ⚠️ Verificar en pruebas que Mailgun conserva el `Message-Id` del MIME enviado por `messages.mime`.

## Costos y riesgos
| Tema | Evaluación |
|---|---|
| Almacenamiento | Adjuntos quedan dos veces (dentro del `.eml` y extraídos). Volumen de soporte inmobiliario: bajo-medio; con Supabase Pro (100 GB incluidos) no es problema en años. Si crece: comprimir `.eml` (gzip) o archivar a almacenamiento frío |
| Latencia | Un salto extra (descarga desde Mailgun): +1–3 s hasta ver el correo en el inbox. Aceptable en email |
| Mailgun caído al descargar | Reintentos durante horas; el mensaje vive ~3 días en Mailgun; DLQ alerta antes de que expire |
| Datos personales | Mismo tratamiento que adjuntos: privado, URL firmada, auditoría de descargas |
| A verificar en pruebas | (1) Contenido exacto del aviso de `store(notify)`. (2) Que `GET message-url` con `Accept: message/rfc2822` devuelva el MIME crudo (campo `body-mime`). (3) Conservación del `Message-Id` en `messages.mime` |
