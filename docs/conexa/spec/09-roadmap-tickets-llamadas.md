# 09 · Fases posteriores: tickets y llamadas (arquitectura preparada)

No se implementan en el MVP. Este documento fija **qué deja listo el MVP** para que entren sin rehacer la base. Referencias: [osticket.md](../investigacion/osticket.md), [freepbx.md](../investigacion/freepbx.md).

## A. Tickets / casos (reemplazo de osTicket)

### Modelo propuesto
```
ticket_topics      (id, account_id, parent_id, name, team_id, sla_policy_id, form_id, active)   -- ≈ help topics osTicket
ticket_forms       (id, account_id, name, schema jsonb)            -- JSON Schema de campos (texto, número, fecha, lista, entidad Sifinca…)
tickets            (id, account_id, number, legacy_number, topic_id, subject, status, priority,
                    team_id, assignee_id, contact_id, form_data jsonb, due_at, first_response_due_at,
                    resolved_at, closed_at, created_by, created_at)
ticket_conversations (ticket_id, conversation_id)                    -- N:M: un caso puede abarcar WA + email + llamada
ticket_events      (como conversation_events: auditoría + base SLA)
sla_policies       (id, first_response_minutes, resolution_minutes, business_hours_id)
external_refs      (id, account_id, owner_type, owner_id, system, entity_type, entity_id, label, data jsonb)
                    -- system='sifinca'; entity_type ∈ contrato, convenio, inmueble, venta_usado, venta_proyecto…
```

### Lo que el MVP ya deja preparado
| Necesidad tickets | Preparación en MVP |
|---|---|
| Hilos multicanal en un caso | Conversaciones con `channel_id`; N:M futuro sin tocar `conversations` |
| Auditoría / SLA | `conversation_events`, `first_response_at`, `priority` |
| Equipos y asignación | `teams`, `team_members`, RLS por equipo — los tickets reutilizan `my_team_ids()` |
| Email con hilos | Threading por Message-Id (igual que osTicket: `ost_thread_entry_email.mid`) → migración de históricos posible |
| Formularios por tipología | `ticket_forms.schema` JSON Schema validado con zod/ajv en `packages/shared`; render dinámico en web |
| Referencias Sifinca | `external_refs` genérico + módulo `apps/api/src/integrations/sifinca/` (cliente de su API/BD, búsqueda y autocompletado de entidades) |
| Notas internas | `content_type='note'` |
| Jobs (vencimientos SLA, recordatorios) | pg-boss ya presente |

### Migración desde osTicket (fase de tickets)
Script ETL leyendo la BD MySQL de osTicket (su API REST sólo crea tickets): `ost_ticket`+`ost_ticket__cdata` → `tickets` (`legacy_number`), `ost_thread_entry` (M/R/N) → `messages` en una conversación de canal "histórico osTicket", `ost_help_topic` → `ticket_topics`, `ost_form*` → `ticket_forms`, `ost_department`/`ost_team` → `teams`, adjuntos `ost_file` → Storage. Ejecutable en seco y repetible.

## B. Llamadas (FreePBX)

### Arquitectura propuesta
```
FreePBX ──AMI(5038)──► conexa-pbx-bridge (servicio pequeño en la red del PBX)
   │                       │  eventos de llamada normalizados (HMAC) → POST /webhooks/voice
   └─ cdr (MySQL) ◄────────┤  reconciliación nocturna por linkedid
   └─ grabaciones ─────────┘  sube a Storage con URL firmada
apps/api ──comando click-to-call──► bridge ──AMI Originate──► extensión del agente → cliente
```
- Canal `voice_freepbx` (nuevo valor del enum) con `config` del troncal/DIDs; `channel_access` igual que los demás.
- Llamada = mensaje `content_type='call'` en la conversación (canal voz, contacto por teléfono), `metadata`: `linkedid`, dirección, duración, `billsec`, disposición, extensión/agente, grabación (`message_attachments`), transcripción.
- Transcripción: job pg-boss `call.transcribe` (faster-whisper self-hosted o API) tras subir el audio; resumen IA opcional reutilizando `lib/ai`.
- Usuarios ↔ extensiones: `profiles.pbx_extension`.
- Se relacionan con tickets vía `ticket_conversations` y con Sifinca vía `external_refs`.

### Lo que el MVP ya deja preparado
`ChannelAdapter` + `ingestInbound` (el bridge entrega eventos ya normalizados), identidades por teléfono compartidas con WhatsApp (mismo contacto), `message_attachments`, jobs, webhooks firmados con HMAC (mismo patrón).
