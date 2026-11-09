# 06 · F3 — Usuarios, equipos y enrutamiento

Base: [análisis 03](../analisis/03-cuentas-roles-seguridad.md) · Inspiración: [wacrm blog "CRM for support"](../investigacion/wacrm-docs-blog.md).

## Estado actual
- Roles de cuenta: `owner > admin > agent > viewer` (`profiles.account_role`). Invitaciones por enlace.
- **Un agent ve y modifica todas las conversaciones** de la cuenta. No hay equipos, colas ni visibilidad por canal. `assigned_agent_id` es solo informativo.

## Conceptos
| Concepto | Regla |
|---|---|
| Equipo | Grupo de usuarios (Arriendos, Ventas usados, Ventas proyectos, Cartera, Mantenimiento, Servicio al cliente…). Un usuario puede estar en varios. Rol en equipo: `member` / `lead`. |
| Acceso a canal | `channel_access` liga un canal con **equipos y/o usuarios**. Quien tiene acceso al canal ve todas sus conversaciones. |
| Equipo de la conversación | `conversations.team_id`. Al crearse toma `channels.default_team_id`; se puede transferir. |
| Asignado | `conversations.assigned_agent_id`: un usuario responsable. |

## Matriz de visibilidad (RLS)
Un usuario ve una conversación (y sus mensajes) si se cumple **alguna**:
1. rol de cuenta `owner`/`admin`;
2. el canal está en `accessible_channel_ids()` (acceso directo o vía equipo);
3. `team_id ∈ my_team_ids()` (le transfirieron la conversación a su equipo aunque no tenga el canal);
4. `assigned_agent_id = auth.uid()`.

`viewer` aplica la misma regla en lectura y no escribe. Políticas y funciones (`auth_account_id`, `auth_account_role`, `accessible_channel_ids`, `my_team_ids`) según el análisis 03 §3, con llamadas envueltas en `(SELECT …)` y `account_id`/`channel_id` desnormalizados en `messages`. Realtime hereda la RLS → cada navegador sólo recibe lo suyo.

En la API, las rutas de usuario usan `withUser()` (RLS activa). Las de servicio usan `assertUserCanAccessConversation()` cuando actúan en nombre de un usuario (p. ej. API pública con key de usuario).

## Requisitos funcionales
| ID | Requisito |
|---|---|
| EQ-1 | Admin CRUD de equipos (nombre, color, descripción, modo de asignación). |
| EQ-2 | Admin gestiona miembros de equipo y su rol (`member/lead`). |
| EQ-3 | En cada canal: equipos y usuarios con acceso + equipo por defecto. |
| EQ-4 | Inbox con vistas: **Mías**, **Sin asignar (mis equipos)**, **Equipo X**, **Todas** (las visibles), con contadores. |
| EQ-5 | Asignar / reasignar: un agent puede tomar una conversación sin asignar de su equipo y asignar a miembros de sus equipos; un `lead` o admin puede asignar a cualquiera con acceso. Trigger de BD rechaza asignar a quien no podría verla. |
| EQ-6 | Transferir a otro equipo (con nota interna opcional). Al transferir se limpia el asignado salvo que pertenezca al equipo destino. |
| EQ-7 | Asignación automática por equipo: `manual` (default) o `round_robin` entre miembros **en línea** (`member_presence`), al llegar el primer mensaje de una conversación nueva o reabierta sin asignado. |
| EQ-8 | Notificaciones: asignación (existe), mensaje nuevo en conversación asignada a mí, nueva conversación sin asignar en mis equipos. Las notificaciones de escritorio dejan de dispararse para toda la cuenta. |
| EQ-9 | Auditoría: todo cambio de estado/asignado/equipo genera `conversation_events`. |
| EQ-10 | Indicador de colisión: quién está viendo/escribiendo en la conversación (Realtime presence por conversación). |
| EQ-11 | Disparar el trigger de automatización `conversation_assigned` (hoy existe en la UI pero nadie lo dispara). |

## API (apps/api)
```
GET/POST/PATCH/DELETE /v1/teams[/:id]
PUT    /v1/teams/:id/members            [{ userId, role }]
PUT    /v1/channels/:id/access          { teamIds: [], userIds: [], defaultTeamId }
PATCH  /v1/conversations/:id            { status?, assignedAgentId?, teamId?, priority?, note? }
GET    /v1/conversations?view=mine|unassigned|team:<id>|all&channel=&status=&cursor=
```

## Aceptación
1. Agente de "Arriendos" no ve conversaciones del canal "Ventas" ni por la UI ni consultando Supabase/Realtime directo con su JWT (test de RLS automatizado).
2. Transferir una conversación de Ventas a Arriendos la hace visible para Arriendos en tiempo real y desaparece para Ventas (si no tienen el canal).
3. Con `round_robin`, 10 conversaciones nuevas se reparten entre los miembros en línea del equipo.
4. Cada cambio de asignación queda en `conversation_events` con actor y hora.
