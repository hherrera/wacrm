# osTicket: conceptos a reemplazar y guía de migración

> Fecha de investigación: 2026-11-09. Referencia: osTicket 1.17/1.18 (rama `develop`).

Fuentes:
- API de tickets: https://github.com/osTicket/osTicket/blob/develop/setup/doc/api/tickets.md
- Documentación general: https://docs.osticket.com/en/latest/
- Esquema de la BD (instalador): https://github.com/osTicket/osTicket/blob/develop/install/sql/osticket-v1.8-mysql.sql y los parches en `include/upgrader/streams/core/`
- Modelos ORM (nombres de tablas y campos): `include/class.ticket.php`, `include/class.thread.php`, `include/class.dynamic_forms.php`, `include/class.topic.php`, `include/class.sla.php` en https://github.com/osTicket/osTicket

> Los nombres de tabla usan el prefijo configurable `ost_` (es el valor por defecto). Antes de migrar, hay que confirmar los nombres en la instancia real con `SHOW TABLES` y `DESCRIBE`.

---

## 1. Conceptos centrales

| Concepto | Qué es en osTicket |
|---|---|
| **Ticket** | La unidad de trabajo. Tiene `number` (visible, con formato configurable, p. ej. `123456`), usuario (cliente), departamento, help topic, SLA, agente y/o equipo asignado, estado, prioridad, fecha de vencimiento (`duedate` manual y `est_duedate` calculada por el SLA), `isoverdue`, `isanswered` y `source` (Web, Email, Phone, API, Other) |
| **Usuario / Organización** | Cliente final (`ost_user`, con varios emails en `ost_user_email`), opcionalmente agrupado en una organización |
| **Agente (Staff)** | Usuario interno. Tiene un departamento principal, accesos extendidos a otros departamentos y un **rol** con permisos por departamento |
| **Departamento** | Bandeja o unidad (Soporte, Arriendos, Ventas, Contabilidad). Tiene SLA por defecto, gerente, email saliente y plantilla de respuesta automática. Se pueden anidar. Define la visibilidad de los agentes |
| **Equipo (Team)** | Grupo de agentes transversal a los departamentos. Un ticket se asigna a un agente **o** a un equipo |
| **Help Topic** | El "motivo" que el cliente elige al abrir el ticket (p. ej. "Daño locativo", "Pago de canon"). Define el departamento destino, la prioridad, el SLA y la auto-asignación, y **asocia formularios custom**. Se pueden anidar (`topic_pid`) |
| **Formularios custom** | `ost_form` + `ost_form_field`. Los formularios se asocian a help topics (`ost_help_topic_form`) y también existen el formulario de ticket base (subject, priority), el de usuario y el de organización. Los valores se guardan en EAV (`ost_form_entry` + `ost_form_entry_values`) y, en caché, en `ost_ticket__cdata` |
| **SLA Plan** | `grace_period` en **horas** hasta el vencimiento, con un horario laboral (schedule) opcional en 1.17+. Al vencer marca el ticket como overdue y alerta. **No distingue la primera respuesta de la resolución:** es un único plazo |
| **Estados** | `ost_ticket_status` con `state` ∈ {`open`, `closed`, `archived`, `deleted`}. Por defecto: *Open*, *Resolved*, *Closed*, *Archived*, *Deleted*. Se pueden crear estados custom sobre esos estados base |
| **Prioridades** | `ost_ticket_priority`: Low, Normal, High, Emergency |
| **Thread** | El hilo de un ticket (también existe para tareas). Contiene **entries** de tipo `M` (mensaje del cliente), `R` (respuesta del agente) y `N` (nota interna), además de **events** (asignado, transferido, cerrado, editado) en `ost_thread_event` |
| **Canned responses** | Respuestas predefinidas (por departamento o globales), con variables `%{ticket.number}`, `%{recipient.name}` y adjuntos |
| **Filtros (Ticket Filters)** | Reglas sobre los entrantes (email/web/API): si el remitente, el asunto o el cuerpo cumplen X, se asigna un departamento, una prioridad, un agente, se rechaza, etc. |
| **Colas (Queues)** | Vistas guardadas (1.11+) con criterios y columnas |
| **Tareas** | Subtareas internas ligadas o no a un ticket |
| **Email** | Buzones configurados (`ost_email`) con fetch IMAP/POP o **piping**, y un departamento y prioridad por defecto |

## 2. Entrada de email

- **Fetching:** el cron (`api/cron.php`, o la llamada HTTP `api/tasks/cron`) lee buzones IMAP/POP.
- **Piping:**
  - El MTA entrega el MIME crudo a `api/pipe.php` (alias `|/usr/bin/php /var/www/osticket/api/pipe.php`). No requiere API key porque es local.
  - Alternativa remota: `POST api/tickets.email` con el MIME crudo y una API key.
- **Threading de osTicket:**
  - Busca `In-Reply-To` y `References` contra los message-id guardados en `ost_thread_entry_email.mid`.
  - Si no hay coincidencia, busca el número de ticket en el asunto (`[#123456]`).
  - También busca un token embebido en los headers o en el cuerpo de las respuestas salientes.
  - Es la misma estrategia que proponemos para Conexa en `mailgun.md`.

## 3. API REST (solo creación)

Según la documentación, la API "supports creation of tickets only". No permite leer, actualizar, responder ni cerrar tickets.

- Endpoints: `POST /api/tickets.json`, `POST /api/tickets.xml` y `POST /api/tickets.email`.
- Auth: header `X-API-Key: <key>`. **La key queda atada a la IP de origen** en *Admin → Manage → API*.
- Respuesta: `201 Created`, con el **número de ticket** en el cuerpo (texto plano).

```json
{
  "alert": true, "autorespond": true, "source": "API",
  "name": "Ana Pérez", "email": "ana@gmail.com", "phone": "3001234567X12",
  "subject": "Gotera en el baño",
  "ip": "190.24.1.1",
  "message": "data:text/html,<p>Hay una gotera…</p>",
  "topicId": 3, "priority": 2,
  "attachments": [ { "foto.jpg": "data:image/jpeg;base64,/9j/4AAQ…" } ],
  "inmueble_codigo": "APT-502"
}
```

- Los campos custom se envían por su `name` del form designer.
- Campos obligatorios: `email`, `name`, `subject` y `message`.
- **Implicación:** para migrar o sincronizar **no se puede usar la API**. Hay que leer la BD MySQL directamente.

## 4. Tablas para la migración

| Tabla | Contenido / columnas clave |
|---|---|
| `ost_ticket` | `ticket_id`, `number`, `user_id`, `user_email_id`, `status_id`, `dept_id`, `sla_id`, `topic_id`, `staff_id`, `team_id`, `email_id`, `source`, `isoverdue`, `isanswered`, `duedate`, `est_duedate`, `reopened`, `closed`, `lastupdate`, `created`, `updated` |
| `ost_ticket__cdata` | Caché "plana" del formulario del ticket: `ticket_id`, `subject`, `priority` y los campos custom del form de ticket. **Es la forma más fácil de obtener el asunto** |
| `ost_ticket_status` | `id`, `name`, `state`, `mode`, `flags`, `sort`, `properties` (JSON) |
| `ost_ticket_priority` | `priority_id`, `priority`, `priority_desc`, `priority_color`, `priority_urgency` |
| `ost_thread` | `id`, `object_id` (ticket_id), `object_type` (`T` = ticket, `A` = tarea), `lastresponse`, `lastmessage`, `created` |
| `ost_thread_entry` | `id`, `pid`, `thread_id`, `staff_id`, `user_id`, `type` (`M`/`R`/`N`), `poster`, `source`, `title`, `body`, `format` (`html`/`text`), `ip_address`, `recipients` (JSON), `created`, `updated` |
| `ost_thread_entry_email` | `thread_entry_id`, `mid` (Message-Id), `headers`. **Hay que migrarlo para que las respuestas a correos viejos sigan agrupándose** |
| `ost_thread_event` | Auditoría: `thread_id`, `event_id`/`state` (created, assigned, transferred, closed, reopened, overdue…), `staff_id`, `team_id`, `dept_id`, `timestamp`, `data` |
| `ost_attachment` | `object_id` (thread_entry id), `type` (`H` = thread entry), `file_id`, `name`, `inline` |
| `ost_file` / `ost_file_chunk` | Metadatos (`type`, `size`, `key`, `signature`, `name`, `bk` = backend) y, si el backend es la BD (`D`), los bytes en chunks. Con el backend de filesystem (`F`), los archivos están en disco |
| `ost_user`, `ost_user_email`, `ost_user_account`, `ost_organization` | Clientes, sus emails y organizaciones |
| `ost_staff`, `ost_staff_dept_access`, `ost_role` | Agentes, sus accesos y roles |
| `ost_department` | `id`, `pid`, `name`, `sla_id`, `manager_id`, `email_id`, `ispublic`, `flags` |
| `ost_team`, `ost_team_member` | Equipos y sus miembros |
| `ost_help_topic` | `topic_id`, `topic_pid`, `topic`, `ispublic`, `dept_id`, `priority_id`, `sla_id`, `staff_id`, `team_id`, `status_id`, `flags`, `sort`, `notes` |
| `ost_help_topic_form` | `topic_id`, `form_id`, `sort`, `extra` (campos deshabilitados) |
| `ost_form` | `id`, `type` (`T` ticket, `U` usuario, `O` organización, `G` genérico), `title`, `instructions`, `name` |
| `ost_form_field` | `id`, `form_id`, `type` (text, memo, choices, date, phone, bool, list-N…), `label`, `name`, `configuration` (JSON), `flags`, `sort` |
| `ost_form_entry` | `id`, `form_id`, `object_id`, `object_type` (`T`, `U`, `O`), `sort`, `extra` |
| `ost_form_entry_values` | `entry_id`, `field_id`, `value`, `value_id` (para listas) |
| `ost_list`, `ost_list_items` | Listas custom (choices de los formularios) |
| `ost_sla` | `id`, `name`, `grace_period` (horas), `schedule_id`, `flags` (activo, transitorio, sin alertas) |
| `ost_schedule`, `ost_schedule_entry` | Horario laboral y festivos (1.17+) |
| `ost_canned_response` | `canned_id`, `dept_id`, `isenabled`, `title`, `response`, `lang`, `notes` (más adjuntos vía `ost_attachment` con `type='C'`) |
| `ost_filter`, `ost_filter_rule`, `ost_filter_action` | Reglas de enrutamiento |
| `ost_email` | Buzones configurados |
| `ost_queue`, `ost_queue_column` | Vistas guardadas |

Consulta base para exportar un ticket con su hilo:
```sql
SELECT t.number, cd.subject, s.name AS status, s.state, d.name AS dept, ht.topic,
       u.name AS user_name, ue.address AS user_email, t.created, t.closed,
       e.type, e.poster, e.body, e.format, e.created AS entry_at, em.mid
FROM ost_ticket t
JOIN ost_ticket__cdata cd ON cd.ticket_id = t.ticket_id
JOIN ost_ticket_status s ON s.id = t.status_id
JOIN ost_department d ON d.id = t.dept_id
LEFT JOIN ost_help_topic ht ON ht.topic_id = t.topic_id
JOIN ost_user u ON u.id = t.user_id
LEFT JOIN ost_user_email ue ON ue.id = t.user_email_id
JOIN ost_thread th ON th.object_id = t.ticket_id AND th.object_type = 'T'
JOIN ost_thread_entry e ON e.thread_id = th.id
LEFT JOIN ost_thread_entry_email em ON em.thread_entry_id = e.id
ORDER BY t.ticket_id, e.created;
```

**Gotchas de migración:**
- Las fechas están en la zona horaria del servidor MySQL; hay que convertirlas a UTC.
- `body` en HTML trae imágenes inline como `cid:` que hay que resolver contra `ost_attachment` con `inline=1`.
- Los campos custom pueden estar en `ost_ticket__cdata` (caché) o solo en `ost_form_entry_values`. **La fuente de verdad es `form_entry_values`.**
- Los tickets fusionados (1.14+) se reconocen por `flags` y `ticket_pid`.
- `ost_ticket.number` debe conservarse como `legacy_number` en Conexa para que los clientes y agentes puedan buscar "el ticket 123456".

## 5. Mapeo osTicket → Conexa

| osTicket | Conexa (propuesta) | Notas |
|---|---|---|
| Ticket | **Conversation** (con estado tipo ticket) | Conexa es omnicanal: una conversación = un "caso". Agregar `number` secuencial visible y `legacy_number` |
| Ticket `source` (Email, Web, Phone, API) | `channel` (`email`, `whatsapp_cloud`, `whatsapp_waha`, `voice`, `web_form`) | |
| User / User email | **Contact** con identidades múltiples (`email`, `phone`, `wa_id`, `wa_lid`) | Unificar por email y teléfono |
| Organization | **Company / Account** (opcional) o propietario/inmueble | Para la inmobiliaria quizá conviene "Inmueble" y "Contrato" como entidades propias |
| Staff | **Agent** (perfil sobre `auth.users` de Supabase) | |
| Role + dept access | **Role** + membresía en equipos (RLS) | |
| Department | **Team / Inbox** | En wacrm y Conexa, el equipo determina la visibilidad y el enrutamiento |
| Team | **Team** (mismo concepto) | osTicket separa Dept y Team; en Conexa se pueden unificar en "Team" con tipo |
| Help Topic | **Topic / Categoría** (tipificación) con `default_team`, `default_priority`, `sla_policy` y `form_id` | Se anidan (`parent_id`) |
| Formularios custom (`ost_form`, `ost_form_field`) | **Custom fields** (`field_definitions` con tipo y config JSON) asociados al topic | |
| `ost_form_entry_values` | `conversation.custom_fields jsonb` | Más simple que el EAV |
| SLA Plan (grace_period) | **SLA Policy** con `first_response_minutes`, `next_response_minutes`, `resolution_minutes` y horario laboral | Conexa mejora a osTicket (que tiene un solo plazo) |
| Schedule | **Business hours** + festivos de Colombia | |
| Ticket status (open/closed/archived) | `status` ∈ {`open`, `pending` (esperando al cliente), `on_hold`, `resolved`, `closed`} | Agregar `pending` para pausar el SLA |
| Priority | `priority` ∈ {`low`, `normal`, `high`, `urgent`} | |
| Thread entry `M` | Message `direction=inbound` | |
| Thread entry `R` | Message `direction=outbound` | |
| Thread entry `N` | Message `type=note` (`private=true`) | |
| Thread event | **conversation_events** (auditoría: asignado, transferido, estado) | |
| `ost_thread_entry_email.mid` | `email_message_ids(message_id, conversation_id)` | Para el threading |
| Attachment / File | **attachments** en Supabase Storage | |
| Canned response | **Macro / Respuesta rápida** (texto, variables y adjuntos; opcionalmente acciones como cambiar estado o asignar) | wacrm ya tiene respuestas rápidas |
| Ticket Filter | **Reglas de automatización / enrutamiento** | |
| Queue | **Vistas guardadas** (filtros) | |
| Task | **Tareas** (fase posterior) | |
| Email piping / fetch | **Mailgun Routes → webhook** | Ver `mailgun.md` |
| API `tickets.json` | Endpoint `POST /api/v1/conversations` (form web, integraciones) | Conexa debería ofrecer CRUD completo |
