# 12 · Multimedia y transcripciones

Cubre imágenes, audios/notas de voz, videos y documentos en **todos los canales**, y la **transcripción** de audios de WhatsApp (MVP) y de llamadas FreePBX (fase de llamadas). Colas en [11](11-colas-y-trabajos.md).

## 1. Estado actual (wacrm)

| Aspecto | Hoy | Problema para Conexa |
|---|---|---|
| Almacenamiento | Bucket Supabase `chat-media`, ruta `account-<id>/<timestamp>-<nombre>` (migración 023) | — |
| Visibilidad del bucket | **`public = TRUE`** para que Meta descargue los enlaces (023:25-41). La migración 043 quitó la política de lectura, pero un bucket público sirve archivos por su URL pública sin pasar por RLS | ⚠️ **Riesgo de datos personales**: cédulas, contratos, extractos que envían los clientes quedan accesibles a quien tenga la URL. Inaceptable para uso real |
| Tamaño máximo | 16 MB para todo (límite de video de Meta) | Correos y documentos superan 16 MB; WhatsApp permite documentos de 100 MB |
| Tipos MIME | Lista cerrada de imágenes, video, PDF y Office | Email trae cualquier tipo (zip, xlsx, txt, eml…); WAHA y Meta envían audio `ogg/opus`, `amr`, `mpeg` |
| Entrante WA Cloud | Descarga de Graph y copia a Storage dentro del webhook (`mirror-inbound-media.ts`), configurable por número | Corre dentro de `after()`: si falla, se pierde el archivo |
| Saliente | El navegador sube a Storage y se envía el **enlace** público a Meta | Depende del bucket público |
| Adjuntos por mensaje | Uno (`messages.media_url`, `media_type`) | Email necesita varios + imágenes inline (`cid:`) |
| Notas de voz salientes | Grabación en navegador con `opus-recorder` → `audio/ogg` (requisito de Meta) | Sirve también para WAHA (`sendVoice`) |
| Transcripción | **No existe** | Requisito nuevo |

## 2. Diseño de almacenamiento (MVP)

1. **Bucket privado** `chat-media` (`public = false`). Migración que cambia el flag y no rompe rutas existentes.
2. **Acceso sólo con URLs firmadas** de vida corta generadas por la API:
   - UI: `GET /v1/attachments/:id/url` → URL firmada (15 min) tras comprobar que el usuario puede ver la conversación (misma regla RLS de [06](06-usuarios-equipos-enrutamiento.md)).
   - Proveedores: WAHA y Mailgun reciben archivo por **URL firmada** (5 min) o contenido; **WhatsApp Cloud**: subir el archivo a Meta (`POST /{phone_number_id}/media`) y enviar por `media_id` en vez de enlace — no depende de que Meta alcance nuestra URL.
3. **Subida desde el navegador** con *signed upload URL* emitida por la API (`POST /v1/media/upload-url` → `{ path, token }`), validando tamaño y tipo según las **capacidades del canal** de la conversación antes de emitirla.
4. Tabla `message_attachments` (ver [03](03-modelo-datos.md)): varios por mensaje, `storage_path`, `filename`, `mime_type`, `size_bytes`, `content_id` (inline email), `sha256`, `width/height`, `duration_s`, `status` (`pending|stored|failed|blocked`). `messages.media_url` se mantiene como compatibilidad (primer adjunto) hasta retirar el código viejo.
5. **Límite del bucket: 100 MB**; el límite efectivo lo impone el canal:

| Canal | Imagen | Audio | Video | Documento |
|---|---|---|---|---|
| WA Cloud (Meta) | 5 MB | 16 MB | 16 MB | 100 MB |
| WAHA | ~16 MB recomendado | 16 MB | 16 MB (64 MB máx. práctico) | 100 MB |
| Email (Mailgun) | 25 MB **por mensaje completo** | ← | ← | ← |

6. **Tipos permitidos**: lista amplia por categorías + **bloqueo de ejecutables** (`.exe .bat .cmd .js .vbs .scr .msi .ps1 .jar`, macros `.docm/.xlsm`) por extensión y *magic bytes*. Los bloqueados se registran con `status='blocked'` y se muestran como "adjunto bloqueado" (no se descargan).
7. **Previsualización**: imágenes con *image transformations* de Supabase (miniaturas on-the-fly, disponible en plan Pro); PDF con visor del navegador; audio/video con reproductor nativo. Sin transcodificación de video en el MVP. ⚠️ Verificar reproducción de `audio/ogg` (opus) en Safari/iOS; si falla, generar una copia `m4a` en el job de transcripción (ya decodifica el audio).
8. **Retención**: política configurable (p. ej. 3 años) con job de archivado; fuera del MVP, pero `created_at` y `size_bytes` permiten calcularla.

## 3. Flujo de media entrante (todos los canales)

```
webhook ─► inbound.ingest ─► message + message_attachments(status=pending)
                          └► media.mirror (prioridad alta)
                                 ├─ WA Cloud: GET Graph media (token del canal)
                                 ├─ WAHA: GET media.url con X-Api-Key (antes de que expire)
                                 └─ Mailgun: adjuntos extraídos del .eml ya guardado (ADR-006)
                              ─► Storage (privado) + sha256 + metadatos (dimensiones, duración)
                              ─► status=stored  ─► Realtime actualiza la burbuja
                              └► si es audio/voz ─► media.transcribe
```

Si `media.mirror` agota reintentos → `status=failed` y la burbuja muestra "no se pudo recuperar el archivo" con botón de reintento (redrive desde DLQ).

## 4. Transcripciones

### Alcance
| Fuente | Fase | Qué se transcribe |
|---|---|---|
| Notas de voz y audios **entrantes** WhatsApp (Cloud y WAHA) | **MVP** | Todos (configurable por canal) |
| Notas de voz **salientes** de agentes | MVP (opcional, off por defecto) | Para búsqueda/auditoría |
| Audio de video | Post-MVP | — |
| **Grabaciones de llamadas** FreePBX | Fase de llamadas | Todas las grabadas, con separación agente/cliente |

### Motor: un único cliente "compatible con OpenAI"
Se implementa **un solo adaptador** contra el endpoint estándar `POST /v1/audio/transcriptions` (multipart: `file`, `model`, `language=es`, `prompt`, `response_format=verbose_json`, `timestamp_granularities[]=segment`). Configurable por cuenta (`transcription_configs`: `base_url`, `model`, `api_key` cifrada, `enabled`, `transcribe_outbound`) — mismo patrón que `ai_configs` existente (que ya soporta `base_url` OpenAI-compatible, migración 046). Esto permite elegir sin cambiar código:

| Opción | Cuándo | Notas |
|---|---|---|
| **API en la nube** (OpenAI `gpt-4o-mini-transcribe`/`whisper-1`, Groq `whisper-large-v3-turbo`, etc.) | Arranque del piloto | Rápido y barato por minuto; **el audio sale de la infraestructura** → revisar autorización de tratamiento de datos (Ley 1581 de 2012) y transferencia internacional. Verificar precios vigentes |
| **Self-hosted** (servidor *faster-whisper* con API compatible OpenAI, p. ej. `speaches`, en contenedor del VPS) | Si el área legal exige que el audio no salga, o para llamadas por volumen | Sin costo por minuto; en CPU, modelos `small`/`medium` (int8) son viables para notas de voz cortas; llamadas largas o `large-v3` piden GPU o más tiempo de cola |

Recomendación MVP: empezar con API en la nube para validar valor y calidad, dejando el contenedor self-hosted documentado para pasar a él con un cambio de configuración.

### Calidad en español colombiano inmobiliario
- `language=es` fijo (evita detección errónea en audios cortos).
- `prompt` con vocabulario del negocio editable por admin: *arriendo, canon, inmueble, administración, depósito, codeudor, fiador, Sifinca, contrato de arrendamiento, paz y salvo, avalúo, escrituración, cartera, consignación…* y nombres de proyectos/barrios.
- Guardar `confidence`/`avg_logprob` por segmento cuando el proveedor lo entregue, para marcar transcripciones dudosas.

### Datos
```sql
CREATE TABLE media_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  attachment_id uuid NOT NULL UNIQUE REFERENCES message_attachments(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending','processing','done','failed','skipped')),
  provider text, model text, language text,
  text text,                         -- transcripción completa
  segments jsonb,                    -- [{start,end,text,speaker?,confidence?}]
  duration_s numeric, error text,
  search tsvector GENERATED ALWAYS AS (to_tsvector('spanish', coalesce(text,''))) STORED,
  created_at timestamptz DEFAULT now(), completed_at timestamptz
);
CREATE INDEX ON media_transcripts USING gin (search);
```
RLS: visible si se puede ver el mensaje (vía `message_attachments → messages`).

### Flujo y uso en el producto
1. `media.mirror` termina → si es audio y la transcripción está activa → `media.transcribe`.
2. El job descarga de Storage, llama al motor, guarda `media_transcripts`, actualiza la burbuja (texto bajo el reproductor, plegable, con aviso "transcripción automática").
3. **Para mensajes de audio, `inbound.process` (flows, automations, IA) espera a la transcripción** y recibe el texto como contenido: el auto-reply IA y las automatizaciones por palabra clave **funcionan también con notas de voz**. Si la transcripción falla o tarda más de 2 min, se procesa como `[audio]` (comportamiento actual).
4. Búsqueda global y del inbox incluye transcripciones (`search` tsvector).
5. Vista previa en la lista de conversaciones: `🎤 "primeras palabras…"`.

### Llamadas (fase FreePBX) — misma maquinaria
- El puente AMI sube la grabación → `message_attachments` en un mensaje `content_type='call'` → `media.transcribe` con opciones de llamada.
- **Separación de hablantes sin diarización costosa**: grabar en **estéreo** con MixMonitor (canal izquierdo = cliente, derecho = agente); el job separa canales (ffmpeg), transcribe cada uno y fusiona segmentos por tiempo con `speaker = customer|agent`.
- Job adicional `call.summarize` (reusa `lib/ai`): resumen, motivo, compromisos, sentimiento → nota interna en la conversación y, más adelante, campos del ticket.
- Aviso legal de grabación en el IVR y retención definida (Ley 1581).
- Volumen: llamadas largas → `groupConcurrency` bajo y, si el volumen lo justifica, motor self-hosted con GPU.

## 5. Requisitos de aceptación (MVP)
1. Ningún archivo de cliente es accesible sin URL firmada (prueba: URL pública del bucket devuelve 400/403).
2. Imagen, audio, video y PDF entrantes por WA Cloud, WAHA y email se ven/reproducen en el inbox; los de WAHA siguen disponibles después de 10 min.
3. Envío de imagen, documento y nota de voz por WA Cloud y WAHA; adjuntos múltiples por email.
4. Un `.exe` adjunto en un correo queda `blocked` y no se puede descargar.
5. Una nota de voz entrante muestra su transcripción en < 30 s (motor en la nube) y la IA puede responder a su contenido.
6. Buscar una palabra dicha en un audio encuentra la conversación.
7. Si el motor de transcripción está caído, los audios se siguen recibiendo y reproduciendo; la transcripción queda `failed` con reintento.

## 6. Ubicación en el plan
| Elemento | Hito |
|---|---|
| Bucket privado, URLs firmadas, `message_attachments`, `media.mirror` en cola | **H0.2** (es corrección de seguridad + base para todos los canales) |
| Límites por capacidades del canal, bloqueo de ejecutables | H1/H2 |
| Adjuntos múltiples e inline | H4 (email) |
| Transcripción de notas de voz | **H2.5** — tras WAHA, antes de equipos (alto valor para el piloto: muchos clientes mandan audios) |
| Transcripción y resumen de llamadas | Fase de llamadas |
