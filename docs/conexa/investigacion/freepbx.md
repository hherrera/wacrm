# FreePBX / Asterisk: opciones de integración (fase posterior)

> Fecha de investigación: 2026-11-09. Esta integración no entra en el MVP. El documento sirve para dejar el modelo de datos de Conexa preparado (canal `voice`, mensajes de tipo `call`).

Fuentes:
- Wiki de Sangoma, CDR Module GraphQL APIs: https://sangomakb.atlassian.net/wiki/spaces/PG/pages/26083384/CDR+Module+GraphQL+APIs
- Foro FreePBX, GraphQL API: https://community.freepbx.org/t/graphql-api/94870
- Foro FreePBX, GraphQL para CDR: https://community.freepbx.org/t/graphql-cdr-reports-freepbx16/93909 y https://community.freepbx.org/t/graphql-api-call-for-cdr-no-documentation-on-this/78893
- Asterisk, columnas del CDR: https://docs.asterisk.org/Configuration/Reporting/Call-Detail-Records-CDR/CDR-Specification/
- Asterisk, eventos AMI: https://docs.asterisk.org/Asterisk_22_Documentation/API_Documentation/AMI_Events/
- Asterisk, acción AMI Originate: https://docs.asterisk.org/Asterisk_22_Documentation/API_Documentation/AMI_Actions/Originate/
- Asterisk REST Interface (ARI): https://docs.asterisk.org/Configuration/Interfaces/Asterisk-REST-Interface-ARI/
- OpenAI Whisper: https://github.com/openai/whisper y faster-whisper: https://github.com/SYSTRAN/faster-whisper

> Las rutas y columnas descritas abajo corresponden a FreePBX 15/16/17 con Asterisk 16–22. Hay que verificarlas en el servidor del cliente (`mysql asteriskcdrdb -e 'DESCRIBE cdr'`).

---

## 1. CDR (Call Detail Records)

**Base de datos:**
- MySQL/MariaDB local, base **`asteriskcdrdb`**, tabla **`cdr`**. También existe `cel` (Channel Event Logging, más granular) si CEL está activo.
- Las credenciales de FreePBX están en `/etc/freepbx.conf` (`AMPDBUSER`/`AMPDBPASS`).
- Para Conexa conviene crear un **usuario MySQL de solo lectura**, restringido a `asteriskcdrdb.*` y a la IP del bridge.

**Columnas de `cdr`:**

| Columna | Significado |
|---|---|
| `calldate` | Inicio de la llamada (datetime, hora local del servidor) |
| `clid` | Caller ID completo (`"Nombre" <300…>`) |
| `src` | Número origen |
| `dst` | Destino marcado (extensión, número externo, `s`) |
| `dcontext` | Contexto de dialplan (`from-internal`, `from-trunk`, `ext-queues`…) |
| `channel` / `dstchannel` | Canales (`PJSIP/101-0000002a`, `PJSIP/trunk-…`) |
| `lastapp` / `lastdata` | Última aplicación (`Dial`, `Queue`, `VoiceMail`) y sus argumentos |
| `duration` | Segundos totales (incluye el ring) |
| `billsec` | Segundos desde que se contestó |
| `disposition` | `ANSWERED`, `NO ANSWER`, `BUSY`, `FAILED` (y `CONGESTION`) |
| `amaflags`, `accountcode`, `userfield`, `peeraccount` | Misceláneos |
| `uniqueid` | Id único **del canal** (`1762700000.123`) |
| `linkedid` | Id que **agrupa todos los legs de la misma llamada** (el `uniqueid` del primer canal). **Es la clave para agrupar una "llamada" de Conexa.** |
| `sequence` | Desempate de orden |
| `did` | DID por el que entró la llamada (FreePBX) |
| `recordingfile` | Nombre del archivo de grabación (FreePBX), p. ej. `external-101-3001234567-20261109-101500-1762700000.123.wav` |
| `cnum`, `cnam`, `outbound_cnum`, `outbound_cnam`, `dst_cnam` | Caller ID normalizado (FreePBX) |

**Gotchas:**
- Una sola llamada genera **varias filas**: una por cada leg o intento (colas, ring groups, transferencias). Hay que agrupar por `linkedid`.
- La llamada se considera "contestada" si alguna fila tiene `disposition='ANSWERED'`. El agente es el `dstchannel` de esa fila.
- `calldate` está en la zona horaria del servidor (America/Bogota). Hay que convertir a UTC al ingerir.
- La fila del CDR se escribe **al colgar**. Para el estado en vivo hace falta AMI.

Consulta incremental de ejemplo:
```sql
SELECT linkedid, MIN(calldate) AS started_at, MAX(billsec) AS talk_sec,
       MAX(disposition='ANSWERED') AS answered,
       MAX(NULLIF(recordingfile,'')) AS recording, MAX(did) AS did,
       SUBSTRING_INDEX(GROUP_CONCAT(src ORDER BY sequence), ',', 1) AS caller
FROM cdr WHERE calldate > ? GROUP BY linkedid;
```

## 2. Grabaciones

- Ruta por defecto: **`/var/spool/asterisk/monitor/YYYY/MM/DD/<recordingfile>`**, normalmente `.wav` (o `.mp3`/`.gsm` según la configuración de *Call Recording*).
- El nombre está en `cdr.recordingfile`. El directorio se deriva de `calldate`.
- Prefijos típicos del nombre: `in-` (entrante a una extensión), `out-` (saliente), `external-`, `q-` (cola), `rg-` (ring group), `ondemand-` (grabación activada con `*1`).
- Para que la llamada se grabe tiene que estar activado en FreePBX: Extensiones, Inbound Routes o Queues → "Call Recording: Force/Yes", o el módulo *Call Recording*.
- Opciones para que Conexa acceda:
  1. **Recomendado:** el bridge sube el archivo a Supabase Storage (o S3) después de colgar y lo transcodifica a mp3/opus para ahorrar espacio.
  2. Montaje NFS o SFTP de solo lectura desde el bridge.
  3. Nunca exponer `/var/spool/asterisk/monitor` por HTTP público.
- Aviso legal (Colombia): informar al cliente que la llamada se graba (IVR) y tener en cuenta la Ley 1581 de 2012 y las políticas de retención.

## 3. AMI (Asterisk Manager Interface)

**Acceso:**
- TCP **5038**, protocolo de texto `Key: Value`.
- El usuario se define en `/etc/asterisk/manager_custom.conf` (no editar `manager.conf`, que lo genera FreePBX):
```ini
[conexa]
secret = <largo>
deny = 0.0.0.0/0.0.0.0
permit = 10.0.0.5/255.255.255.255
read = call,cdr,agent,user
write = originate,call
writetimeout = 5000
```
- Luego: `asterisk -rx "manager reload"`.
- **Nunca exponer el 5038 a internet.** Usar VPN o túnel; AMI va en texto plano (existe la opción TLS en 5039).

**Eventos relevantes:**

| Evento | Uso |
|---|---|
| `Newchannel` | Se creó un canal. Trae `Channel`, `CallerIDNum`, `Exten`, `Context`, `Uniqueid` y `Linkedid`. Sirve para detectar una llamada entrante por un DID o trunk |
| `Newstate` | Cambio de estado (`ChannelStateDesc`: `Ring`, `Ringing`, `Up`) |
| `DialBegin` | Empieza a sonar un destino (`DestChannel`, `DestCallerIDNum` = extensión del agente). Sirve para el *screen pop* en Conexa |
| `DialEnd` | Resultado del dial (`DialStatus`: `ANSWER`, `BUSY`, `NOANSWER`, `CANCEL`, `CHANUNAVAIL`) |
| `BridgeEnter` / `BridgeLeave` | Los participantes quedan conectados o se desconectan |
| `AgentConnect` / `QueueCallerJoin` / `QueueCallerAbandon` | Métricas de colas |
| `Hangup` | Fin del canal (`Cause`, `Cause-txt`) |
| `Cdr` | Se emite al escribir el CDR (si `cdr_manager` está habilitado en `cdr_manager.conf`) con todos los campos. **Es la forma más simple de ingerir sin hacer polling a MySQL.** |
| `VarSet` / `UserEvent` | Variables custom (p. ej. `MIXMONITOR_FILENAME` revela la ruta de la grabación) |

Todo se correlaciona por `Linkedid`.

**Click-to-call (AMI `Originate`):**
```
Action: Originate
ActionID: conexa-7f3a
Channel: PJSIP/101
Context: from-internal
Exten: 3001234567
Priority: 1
CallerID: "Conexa" <101>
Variable: CONEXA_CONV_ID=8f3k2q
Timeout: 30000
Async: true
```
Primero suena la extensión del agente; al contestar, Asterisk marca al cliente por `from-internal` (respetando las outbound routes). El evento `OriginateResponse` llega con el `ActionID`. La variable `CONEXA_CONV_ID` se puede leer después con `VarSet` o dejarla en `userfield`/`accountcode` para correlacionar con la conversación.

## 4. ARI (Asterisk REST Interface)

- HTTP/WS en el puerto **8088** (`/ari/...`), con usuario en `ari_additional_custom.conf` (FreePBX tiene la pantalla *Settings → Asterisk REST Interface Users*).
- Sirve para **controlar** llamadas desde una aplicación Stasis: IVR propio, bridges, `snoop` para obtener el audio en vivo y `externalMedia` para hacer streaming de RTP a un servicio de transcripción en tiempo real.
- Solo ve los canales que entran a `Stasis(app)`, así que **no sustituye a AMI para observar** todo el tráfico de FreePBX.
- Para Conexa: **solo hace falta en una fase avanzada** (transcripción en vivo o agent assist). Para registrar llamadas, clic para llamar y grabaciones basta con AMI y CDR.

## 5. API GraphQL de FreePBX

- Módulo **API** (FreePBX 15+). Endpoint **`/admin/api/api/gql`**, con autenticación OAuth2:
  - Se crea una aplicación "Machine-to-Machine" en *Connectivity → API*, que entrega `client_id` y `client_secret`.
  - El token se pide en `/admin/api/api/token` y se envía como `Authorization: Bearer`, con scopes por módulo (`gql`, `gql:core`, `gql:cdr`…).
  - **Verificar en el servidor:** la documentación oficial sobre la autenticación es escasa y en el foro hay usuarios atascados en ese paso.
- **Qué cubre:** sobre todo **aprovisionamiento y administración**: extensiones o usuarios, ring groups, inbound y outbound routes, troncales, colas (según el módulo), reload de la configuración y estado del sistema.
- **CDR:** `fetchAllCdrs(first, after, orderby, startDate, endDate) { totalCount cdrs { … } }` y `fetchCdr(id)`. El schema **no expone todas las columnas** (en el foro reportan que falta `outbound_cnum`), y la documentación del módulo CDR en la wiki de Sangoma es escasa.
- **No tiene eventos ni suscripciones en tiempo real** ni webhooks nativos.
- Uso en Conexa: opcional, para sincronizar la lista de extensiones con los agentes (mapear `agent.extension`). Para las llamadas, AMI más CDR es más completo.

## 6. Opciones de "webhooks"

FreePBX no tiene webhooks de llamadas nativos. Alternativas:
1. **Bridge AMI** que traduce eventos a HTTP. **Recomendado.**
2. Un dialplan custom en `extensions_custom.conf` con `CURL()`/`System()` en un hook (p. ej. `[macro-dialout-trunk-predial-hook]` o en `h` del contexto). Es frágil y bloquea el dialplan.
3. Módulos comerciales de Sangoma (CRM Link / Zulu): de pago y de nicho.
4. Polling a `asteriskcdrdb.cdr` con un cursor `calldate`/`sequence`. Es lo más simple, pero sin tiempo real.

## 7. Transcripción

**Opciones:**

| Opción | Pros | Contras |
|---|---|---|
| **faster-whisper** autoalojado (`large-v3` o `distil`), con GPU o CPU int8 | Barato a volumen, los datos no salen | Hay que operar GPU; sin diarización nativa (agregar `pyannote` o WhisperX) |
| API OpenAI (`whisper-1` / `gpt-4o-transcribe`) | Cero infraestructura, buen español | Costo por minuto, los datos salen del país |
| Deepgram / AssemblyAI | Diarización, timestamps por palabra, streaming | Costo, los datos salen |

**Recomendaciones:**
- Grabar en **estéreo** (cliente en un canal, agente en otro; `MixMonitor` con las opciones `r()`/`t()`, o el modo split de FreePBX 17) para tener una diarización perfecta sin modelo extra.
- Transcribir **en lote al colgar**, encolado en un job.
- Después, generar un resumen con un LLM ("motivo de la llamada", "próximos pasos") y guardarlo como nota interna en la conversación.
- Idioma `es`. Agregar un vocabulario de dominio inmobiliario (arriendo, canon, administración, inmueble, codeudor) como *prompt* inicial de Whisper.

## 8. Arquitectura recomendada

```
┌──────────── Red del PBX (on-prem / VPS) ─────────────┐
│ FreePBX/Asterisk                                      │
│   AMI :5038  ───TCP──▶  conexa-pbx-bridge (Node/Go)    │
│   /var/spool/asterisk/monitor  ◀──lectura local──┘     │
│   asteriskcdrdb (MySQL, RO)  ◀──reconciliación──┘      │
└──────────────────────────────┬───────────────────────┘
                               │ HTTPS saliente (HMAC)
                               ▼
        Conexa  POST /api/ingest/voice  (Next.js route)
           ├─ upsert contact por número (E.164 +57…)
           ├─ upsert conversation canal "voz" por linkedid
           ├─ message type=call {direction, from, to, agent_ext,
           │     status, ring_sec, talk_sec, recording_url}
           └─ encola job transcripción → nota interna + resumen
        Conexa  → bridge: POST /originate (click-to-call)  [WS o polling]
```

**Detalles del bridge:**
- Proceso pequeño (Node con `asterisk-manager`/`asterisk-ami-client`, o Go) desplegado **junto al PBX**. Así AMI nunca sale de la LAN. Se conecta *hacia afuera* a Conexa, sin abrir puertos entrantes en el PBX.
- Mantiene en memoria el estado de cada `linkedid` y emite a Conexa:
  - `call.ringing` (en `DialBegin`, para el screen pop del agente con `DestCallerIDNum` = extensión)
  - `call.answered`
  - `call.ended` (al recibir el evento `Cdr` agregado por `linkedid`)
  - `call.recording_ready`
- Al terminar, sube la grabación a Storage con una URL firmada que entrega Conexa, para no guardar las credenciales de Storage en el PBX.
- Firma cada POST con `X-Conexa-Signature` = HMAC-SHA256 del body y un timestamp. La idempotencia se basa en `linkedid` + tipo de evento.
- Reconciliación nocturna contra `asteriskcdrdb.cdr` para recuperar los eventos perdidos durante caídas del bridge.
- Click-to-call: Conexa publica comandos (una tabla `pbx_commands` con Supabase Realtime, o un WebSocket que mantiene el bridge) y el bridge ejecuta `Originate`. Esto evita exponer el bridge.
- Modelo de datos en Conexa:
  - Tabla de canales con un canal `type='voice'` por PBX (o por DID).
  - `agents.pbx_extension`.
  - `messages.type='call'` con `metadata jsonb` (linkedid, disposition, billsec, recording_path, transcript_id).
