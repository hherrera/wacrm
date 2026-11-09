# 03 — Cuentas, roles y seguridad (multi-tenancy, auth, RLS, secretos)

> Análisis de solo lectura sobre el fork de wacrm. Todas las referencias son `ruta:línea` relativas a la raíz del repo.
> Fecha: 2026-11-09.

---

## 0. Resumen ejecutivo

- **Tenant = `accounts`**. La membresía **no** vive en una tabla `account_members`: está en `profiles.account_id` + `profiles.account_role` (relación 1 usuario → 1 cuenta). No existe tabla `account_members`.
- **Roles**: enum `account_role_enum` = `owner > admin > agent > viewer` (`supabase/migrations/017_account_sharing.sql:53`), reflejado 1:1 en TS (`src/lib/auth/roles.ts:18-43`).
- **Aislamiento**: RLS con el helper `is_account_member(account_id, min_role)` SECURITY DEFINER (`017:136-167`). Patrón de tres niveles: lectura viewer+, escritura operativa agent+, escritura de configuración admin+.
- **Hoy un `agent` ve TODAS las conversaciones y mensajes de la cuenta.** `assigned_agent_id` es solo metadato (notificaciones/filtros), no restringe visibilidad.
- **No existen equipos, grupos, departamentos ni canales** como entidades. Solo hay **un** `whatsapp_config` por cuenta (`017:319-328`, `UNIQUE(account_id)`).
- **Secretos**: AES-256-GCM con una única `ENCRYPTION_KEY` global (`src/lib/whatsapp/encryption.ts:29-48`); reutilizado para tokens de WhatsApp, API keys de IA y secretos de webhooks salientes.
- **Webhooks**: HMAC-SHA256 con comparación en tiempo constante (`src/lib/whatsapp/webhook-signature.ts`) y esquema Stripe-like con timestamp para salientes (`src/lib/webhooks/sign.ts`). Ambos reutilizables para WAHA y Mailgun.

---

## 1. Modelo de tenancy

### 1.1 Tablas

| Objeto | Definición | Notas |
|---|---|---|
| `account_role_enum` | `017:50-55` | `('owner','admin','agent','viewer')` |
| `accounts` | `017:60-69` | `owner_user_id` desnormalizado; `UNIQUE(owner_user_id)` (`017:73-74`) → un usuario es dueño de máx. 1 cuenta |
| `account_invitations` | `017:90-105` | Guarda `token_hash` (SHA-256), nunca el token; `role <> 'owner'` por CHECK |
| `profiles.account_id`, `profiles.account_role` | `017:120-125` | Fuente de verdad de la membresía. NOT NULL (`017:274-275`). Índice `(account_id, account_role)` |
| `profiles.role TEXT` | `001:13-24` | Legado, sin uso (comentado en `017:31-32`) |
| `member_presence` | `024_member_presence.sql:31-49` | Heartbeat online/away; escritura solo vía RPC `touch_presence` |

Decisión de diseño explícita: "one-account-per-user" (`017:71-74`, `017:109-114`). Consecuencia: **un usuario no puede pertenecer a dos cuentas**; `redeem_invitation` lo impide si el usuario ya está en una cuenta compartida o tiene datos (`047:309-355`).

Todas las tablas de dominio llevan `account_id NOT NULL` con índice (`017:176-190`, `017:276-309`). La columna `user_id` se conserva pero **ya no aísla** (`017:33-35`, `017:351-352`).

### 1.2 Ciclo de vida de la membresía

- **Alta**: trigger `handle_new_user` crea cuenta personal + perfil `owner` en la misma transacción (`017:659-689`). Ojo: traga errores con `EXCEPTION WHEN OTHERS ... RETURN NEW` (`017:679-681`) → puede dejar un `auth.users` sin perfil (ya ocurrió; ver curación en `017:218-236`).
- **Invitación**: `POST /api/account/invitations` (admin, rate-limited) → token 32 bytes base64url, se persiste solo el hash (`src/lib/auth/invitations.ts:47-59`). URL `/join/<token>` (`invitations.ts:70-73`). Expiración 7 días por defecto, máx. 365 (`invitations.ts:29-32`).
- **Peek anónimo**: `GET /api/invitations/[token]/peek` → RPC `peek_invitation` (anon+authenticated, `019:43-89`), rate-limit por IP 30/min (`src/app/api/invitations/[token]/peek/route.ts:42`).
- **Redención**: `POST /api/invitations/[token]/redeem` → RPC `redeem_invitation` (`047:258-375`): bloquea filas, valida expiración/uso, exige que la cuenta personal del invitado esté vacía, mueve `profiles.account_id/role` y borra la cuenta huérfana.
- **Cambio de rol / baja / transferencia**: RPCs SECURITY DEFINER `set_member_role`, `remove_account_member`, `transfer_account_ownership` (`018`, endurecidas en `047:27-256` y `055:260-347`). Todas: `auth.uid()` obligatorio, `FOR UPDATE` ordenado sobre ambos perfiles (anti-deadlock), misma cuenta, nadie toca al owner salvo transferencia. `remove_account_member` además desasigna las conversaciones del expulsado (`055:336-339`).
- **Protecciones de columnas**:
  - `enforce_profile_privilege_columns` (`055:3-35`): el rol `authenticated` no puede INSERT en `profiles` ni cambiar `account_role`/`account_id` por UPDATE directo. Cierra el agujero de `profiles_update` (`017:614-616`), que permitía a cualquier usuario auto-ascenderse.
  - `enforce_account_identity_columns` (`047:1-25`): `owner_user_id`, `id`, `created_at` de `accounts` inmutables para `authenticated`.
  - `enforce_conversation_assignee_membership` (`055:145-193`): `assigned_agent_id` debe ser miembro de la misma cuenta; si no, se revierte/anula silenciosamente.

### 1.3 Resolución de `account_id` por request

| Contexto | Mecanismo | Referencia |
|---|---|---|
| Dashboard (cookies) | `getCurrentAccount()`: `auth.getUser()` → `profiles.account_id/account_role` → `accounts` por id | `src/lib/auth/account.ts:109-176` |
| Dashboard + rol mínimo | `requireRole(min)` = `getCurrentAccount` + `hasMinRole` → `ForbiddenError` 403 | `src/lib/auth/account.ts:185-193` |
| Mapeo de errores | `toErrorResponse` (401/403, resto 500 sin filtrar mensaje) | `src/lib/auth/account.ts:72-78` |
| API pública `/api/v1` | `requireApiKey(req, scope)`: hash SHA-256 del bearer → fila `api_keys` → `accountId` fijo; **cliente service-role** | `src/lib/auth/api-context.ts:78-116` |
| Cliente browser | Singleton `createBrowserClient` con anon key; el aislamiento depende 100 % de RLS | `src/lib/supabase/client.ts:9-18` |
| Webhooks / cron / engines | Service role; `account_id` derivado del payload (p. ej. `phone_number_id → whatsapp_config.account_id`) | `src/app/api/whatsapp/webhook/route.ts:44-54`, `:280-303` |

El `account_id` **nunca** viaja como parámetro del cliente en rutas con sesión: se deriva siempre del perfil. Las queries del navegador (p. ej. la bandeja) ni siquiera filtran por cuenta: `src/components/inbox/conversation-list.tsx:107-110` hace `select ... order(last_message_at)` y confía en RLS.

### 1.4 Middleware / proxy

- Archivo: `src/middleware.ts` (no existe `src/proxy.ts`; en Next 16 `middleware` está deprecado en favor de `proxy` — renombrar en algún momento).
- Refresca sesión Supabase y propaga cookies rotadas a redirecciones (`src/middleware.ts:26-43`).
- Redirige a `/login` en rutas protegidas (lista fija, `:75-80`).
- **Solo** devuelve 401 automático para `/api/whatsapp/*` excepto `/webhook` (`:83-88`). El resto de `/api/*` depende de que cada ruta llame a `getCurrentAccount`/`requireRole`. Un endpoint nuevo que lo olvide queda protegido solo por RLS (si usa el cliente SSR) o **sin protección** (si usa service role).

### 1.5 Helpers SQL existentes

| Función | Tipo | Uso | Ref |
|---|---|---|---|
| `is_account_member(uuid, role default 'viewer')` | `sql STABLE SECURITY DEFINER`, `search_path=public` | Todas las políticas | `017:136-167` |
| `touch_presence(text)` | plpgsql SECURITY DEFINER | Heartbeat | `024:56-` |
| `peek_invitation(text)` | STABLE SECURITY DEFINER, `anon` | Join | `019:43-89` |
| `redeem_invitation`, `set_member_role`, `remove_account_member`, `transfer_account_ownership` | plpgsql SECURITY DEFINER, `REVOKE PUBLIC` + `GRANT authenticated` | Gestión de miembros | `047`, `055` |
| `_bcast_bump`, `recompute_broadcast_counts`, `claim_ai_reply_slot`, `record_webhook_failure`, `merge_duplicate_*` | internas | **Solo `service_role`** tras `044_internal_definer_grants.sql:1-17` | `044` |

Lección de `044`: toda función SECURITY DEFINER interna debe hacer `REVOKE ALL ... FROM PUBLIC, anon, authenticated` explícito; por defecto Postgres concede EXECUTE a PUBLIC.

### 1.6 Patrón de RLS

Tablas padre (con `account_id`), `017:384-480`:

```sql
CREATE POLICY x_select ON x FOR SELECT USING (is_account_member(account_id));            -- viewer+
CREATE POLICY x_insert ON x FOR INSERT WITH CHECK (is_account_member(account_id,'agent')); -- o 'admin' en settings
CREATE POLICY x_update ON x FOR UPDATE USING (is_account_member(account_id,'agent'));
CREATE POLICY x_delete ON x FOR DELETE USING (is_account_member(account_id,'agent'));
```

- Clase "settings" (admin+ para escribir): `tags`, `custom_fields`, `whatsapp_config`, `message_templates`, `pipelines`, `ai_configs` (`029:66-80`), `webhook_endpoints` (`028:63-78`), `api_keys` (`026:68-85`).
- Clase "operativa" (agent+): `contacts`, `conversations`, `deals`, `broadcasts`, `automations`, `flows`, `contact_notes`.
- Solo lectura cliente / escritura service-role: `automation_logs`, `flow_runs`, `automation_pending_executions` (`017:461-480`).

Tablas hijas (sin `account_id`) usan semántica de join con el padre, p. ej. `messages` (`017:511-518`):

```sql
USING (EXISTS (SELECT 1 FROM conversations c
               WHERE c.id = messages.conversation_id AND is_account_member(c.account_id)))
```

`message_reactions` hace doble join `messages → conversations` (`017:576-598`).

Storage (`055:37-143`): rutas `account-<uuid>/...` validadas contra `profiles` con `account_role IN ('owner','admin','agent')`.

Observaciones:
- Las políticas UPDATE no tienen `WITH CHECK` (`017:388`, `:416`, etc.) → Postgres reutiliza `USING`, que basta porque valida la fila nueva contra la misma condición; pero mover una fila a otra cuenta propia es imposible solo porque el usuario tiene una sola cuenta.
- `profiles_select` (`017:612-613`) permite a cualquier miembro leer **todas** las columnas de los perfiles de su cuenta, incluido `email`.

### 1.7 Uso de service role

Clientes service-role duplicados: `src/lib/flows/admin-client.ts:8-16`, `src/lib/automations/admin-client.ts:12`, `src/lib/ai/admin-client.ts:13`, `src/app/api/whatsapp/webhook/route.ts:44-54`, `src/app/api/whatsapp/config/route.ts:69`. Todos bypassean RLS, así que la disciplina es **filtrar siempre por `account_id` explícitamente**. Ejemplo de guardia: `assertConversationInAccount` (`src/lib/whatsapp/conversation-scope.ts:33-50`), introducida tras el advisory GHSA-m4fx-g6pr-hrw8 (un `conversation_id` controlado por el cliente permitía escribir en el hilo de otro tenant).

El webhook de Meta resuelve la cuenta por `phone_number_id` y descarta si hay 0 o >1 coincidencias (`webhook/route.ts:280-303`; unicidad en `013_whatsapp_config_phone_number_id_unique.sql`).

---

## 2. Permisos en código de aplicación

### 2.1 Predicados (`src/lib/auth/roles.ts`)

| Predicado | Mínimo | Línea |
|---|---|---|
| `canManageMembers` | admin | `:70-72` |
| `canEditSettings` | admin | `:79-81` |
| `canSendMessages` | agent | `:88-90` |
| `canViewOnly` | == viewer | `:97-99` |
| `canDeleteAccount`, `canTransferOwnership` | == owner | `:102-109` |

UI: `useAuth()` expone los booleanos (`src/hooks/use-auth.tsx:410-412`), `useCan()` (`src/hooks/use-can.ts:46-50`) y el componente `<RequireRole min>` (`src/components/auth/require-role.tsx:35-47`, falla cerrado mientras carga). Son **solo cosméticos**; la autoridad real es servidor + RLS.

### 2.2 Dónde se aplica en servidor (muestra)

- `agent`: `api/whatsapp/send/route.ts:39`, `api/whatsapp/react/route.ts:34`, `api/whatsapp/broadcast/route.ts:78`, `api/flows/*`, `api/automations/route.ts:35`, `api/ai/draft/route.ts:28`, `api/contacts/[id]/tags/route.ts:31`, `api/quick-replies/*`.
- `admin`: `api/whatsapp/config/route.ts:260,591`, `api/whatsapp/templates/*`, `api/ai/config|test|knowledge|usage`, `api/account/route.ts:46`, `api/account/invitations/route.ts:144,172`, `api/account/members/[userId]/route.ts:53,105`, `api/account/api-keys/route.ts:76`.
- `owner`: `api/account/transfer-ownership/route.ts:63` (además la RPC lo vuelve a comprobar).
- Solo sesión (cualquier rol): `api/account/members/route.ts:35` (oculta emails a no-admins en `:53-64`), `api/whatsapp/health/route.ts:26`, `api/ai/config` GET.

Rate limiting de acciones administrativas: `RATE_LIMITS.adminAction` 30/min (`src/lib/rate-limit.ts`, bloque `RATE_LIMITS`).

### 2.3 Qué ve hoy un `agent`

- **Todas** las conversaciones (`conversations_select` = `is_account_member(account_id)`, `017:414`) y todos los mensajes (`017:511-513`) de la cuenta, estén o no asignadas a él.
- Puede **escribir/actualizar/borrar** cualquier conversación y mensaje de la cuenta (`017:415-417`, `:514-518`), incluido reasignar `assigned_agent_id` a otro miembro.
- Realtime: las suscripciones `postgres_changes` sobre `messages` y `conversations` no llevan filtro (`src/hooks/use-realtime.ts:48-66`, `src/hooks/use-browser-notifications.ts:123-126`); Supabase aplica RLS por suscriptor, así que recibe todo lo de su cuenta.
- Lee todos los contactos, deals, plantillas, config de WhatsApp (ciphertext incluido), config de IA (ciphertext de la API key) y endpoints de webhook (ciphertext del secreto) porque los SELECT son viewer+.
- Puede leer `email` de compañeros vía PostgREST directo aunque `/api/account/members` lo oculte.
- `viewer` = lo mismo pero sin escrituras.

---

## 3. Equipos / canales: estado actual y propuesta

### 3.1 Estado actual

- No hay `teams`, `groups`, `departments`, `channels` ni `inboxes` en migraciones ni en `src/` (búsqueda sin resultados).
- "Team members" en la UI = miembros de la cuenta (`src/components/settings/members-tab.tsx`, `024:2-6`).
- Bloqueos estructurales para multicanal:
  - `whatsapp_config UNIQUE(account_id)` (`017:319-328`): un solo número por cuenta.
  - `idx_conversations_account_contact` UNIQUE `(account_id, contact_id)` (`036_conversation_contact_dedup.sql:125`): una sola conversación por contacto → el mismo cliente escribiendo por WA-Cloud, WAHA y email colapsaría en un hilo. Hay que añadir `channel_id` a la clave.
  - `messages` no tiene `account_id` ni `channel_id`; su RLS depende del join con `conversations`.

### 3.2 Modelo propuesto

```sql
-- Canal genérico (WA Cloud, WAHA, Mailgun, luego voz)
CREATE TYPE channel_kind AS ENUM ('wa_cloud','waha','email_mailgun');
CREATE TABLE channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind channel_kind NOT NULL,
  name text NOT NULL,
  external_id text NOT NULL,           -- phone_number_id / session name / dominio+buzón
  config jsonb NOT NULL DEFAULT '{}',  -- solo datos NO secretos
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (kind, external_id)           -- enrutamiento inequívoco del webhook
);
CREATE INDEX ON channels(account_id);

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  UNIQUE (account_id, name)
);

CREATE TABLE team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, -- desnormalizado para RLS/índices
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX ON team_members(user_id, account_id);

-- Acceso canal ↔ equipo o usuario (exactamente uno)
CREATE TABLE channel_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  CHECK ((team_id IS NULL) <> (user_id IS NULL))
);
CREATE UNIQUE INDEX ON channel_access(channel_id, team_id) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX ON channel_access(channel_id, user_id) WHERE user_id IS NOT NULL;

ALTER TABLE conversations ADD COLUMN channel_id uuid REFERENCES channels(id),
                          ADD COLUMN team_id uuid REFERENCES teams(id);
ALTER TABLE messages      ADD COLUMN account_id uuid, ADD COLUMN channel_id uuid; -- desnormalizar (ver 3.4)
-- y sustituir idx_conversations_account_contact por (account_id, channel_id, contact_id)
```

Triggers de integridad análogos a `enforce_conversation_assignee_membership` (`055:145-193`): `team_members.user_id` y `channel_access.*` deben pertenecer a `account_id`; `conversations.team_id` debe ser de la misma cuenta. Al expulsar a un miembro (`remove_account_member`), borrar sus `team_members` y `channel_access`.

### 3.3 Helpers SQL propuestos

Siguiendo el estilo de `is_account_member` (sql, STABLE, SECURITY DEFINER, `search_path` fijado, OWNER postgres, `REVOKE PUBLIC`):

```sql
-- Cuenta del caller (1 usuario = 1 cuenta). Permite políticas hoisteables.
CREATE FUNCTION auth_account_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT account_id FROM profiles WHERE user_id = auth.uid()
$$;

CREATE FUNCTION auth_account_role() RETURNS account_role_enum
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT account_role FROM profiles WHERE user_id = auth.uid()
$$;

-- Canales visibles para el caller: admin/owner ven todos; resto por usuario o equipo.
CREATE FUNCTION accessible_channel_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN p.account_role IN ('owner','admin') THEN
           ARRAY(SELECT id FROM channels WHERE account_id = p.account_id)
         ELSE
           ARRAY(SELECT ca.channel_id FROM channel_access ca
                 WHERE ca.account_id = p.account_id
                   AND (ca.user_id = p.user_id
                        OR ca.team_id IN (SELECT team_id FROM team_members tm
                                          WHERE tm.user_id = p.user_id)))
         END
  FROM profiles p WHERE p.user_id = auth.uid()
$$;

CREATE FUNCTION my_team_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(team_id), '{}') FROM team_members WHERE user_id = auth.uid()
$$;

CREATE FUNCTION can_see_conversation(c_account uuid, c_channel uuid, c_team uuid, c_assignee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ ... $$;
-- útil para RPCs / service role, no para la política caliente.
```

### 3.4 Boceto de políticas

Regla de negocio sugerida (a validar con el negocio inmobiliario):
1. owner/admin: todo lo de la cuenta.
2. agent/viewer: conversación visible si `channel_id ∈ canales accesibles` **o** `assigned_agent_id = auth.uid()` **o** `team_id ∈ mis equipos`.
3. Escritura: agent+ con la misma visibilidad.

```sql
DROP POLICY conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT USING (
  account_id = (SELECT auth_account_id())
  AND (
        (SELECT auth_account_role()) IN ('owner','admin')
     OR channel_id = ANY ((SELECT accessible_channel_ids()))
     OR assigned_agent_id = (SELECT auth.uid())
     OR team_id = ANY ((SELECT my_team_ids()))
  )
);
-- conversations_update / _delete: igual + (SELECT auth_account_role()) <> 'viewer'
-- + WITH CHECK idéntico para impedir mover la conversación a un canal no accesible.

DROP POLICY messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  account_id = (SELECT auth_account_id())
  AND (
        (SELECT auth_account_role()) IN ('owner','admin')
     OR channel_id = ANY ((SELECT accessible_channel_ids()))
     OR EXISTS (SELECT 1 FROM conversations c
                WHERE c.id = messages.conversation_id
                  AND (c.assigned_agent_id = (SELECT auth.uid())
                       OR c.team_id = ANY ((SELECT my_team_ids()))))
  )
);
```

`channels`, `teams`, `team_members`, `channel_access`: SELECT `account_id = (SELECT auth_account_id())`; escritura `is_account_member(account_id,'admin')` (clase settings). Contactos: decidir si siguen siendo visibles para toda la cuenta (lo más simple en CRM inmobiliario) o se restringen por conversación.

Código de app a tocar en paralelo (service role no ve la política): `assertConversationInAccount` debe evolucionar a "puede el usuario X operar en la conversación Y" para rutas que usan admin client en nombre de un usuario (send, react, AI draft, automations manuales), y `/api/v1` debe decidir si una API key es de cuenta completa o lleva scope de canales.

### 3.5 Rendimiento

- **Envolver en `(SELECT ...)`** las llamadas sin argumentos de fila (`auth.uid()`, `auth_account_id()`, `accessible_channel_ids()`): Postgres las evalúa una vez como InitPlan en vez de por fila. El patrón actual `is_account_member(account_id)` recibe una columna y **se ejecuta por fila** (un lookup en `profiles` por fila); con decenas de miles de mensajes es el principal coste de RLS hoy.
- **Desnormalizar `account_id` y `channel_id` en `messages`** (rellenar por trigger desde `conversations`) para evitar el `EXISTS` con join por fila de `017:511-513`. Índices: `messages(account_id, channel_id, created_at)`, `messages(conversation_id, created_at)`.
- Índices en `conversations`: `(account_id, channel_id, last_message_at DESC)`, `(account_id, assigned_agent_id)`, `(account_id, team_id)`; la bandeja ordena por `last_message_at` (`conversation-list.tsx:110`).
- `team_members(user_id)`, `channel_access(user_id)`, `channel_access(team_id)`, `channel_access(channel_id)`.
- Las funciones deben ser `STABLE` (no VOLATILE) y SECURITY DEFINER para no recursar en RLS de `profiles`/`team_members`; `OWNER TO postgres`, `SET search_path = public`, `REVOKE ALL FROM PUBLIC, anon` y `GRANT EXECUTE TO authenticated, service_role` (lección de `044`).
- **Realtime**: Supabase evalúa la política SELECT por suscriptor por evento. Con N agentes conectados y políticas con subconsultas, cada INSERT en `messages` cuesta N evaluaciones. Mitigar con políticas baratas (columnas desnormalizadas + arrays en InitPlan) o migrar a canales Broadcast por `channel_id`/`team_id` autorizados vía `realtime.messages` RLS.
- Alternativa futura: poner `account_id`/rol en custom claims del JWT (Supabase Auth Hook) para evitar el lookup a `profiles`; requiere invalidar sesión al cambiar rol.

---

## 4. Secretos

### 4.1 Situación actual

- `encrypt/decrypt` AES-256-GCM, IV 12 bytes, tag 16 bytes, formato `iv:ct:tag` hex; descifrado legado CBC (`src/lib/whatsapp/encryption.ts:37-103`). Migración perezosa de CBC→GCM en `api/whatsapp/send/route.ts` (comentario `encryption.ts:24-26`).
- Una sola clave global `ENCRYPTION_KEY` (64 hex) (`encryption.ts:29`; `.env.local.example:20-25`). Sin versión de clave en el ciphertext → rotar invalida todos los tokens (`.env.local.example:23-24`). Sin AAD: un ciphertext puede copiarse de una fila/cuenta a otra y seguirá descifrando.
- Usos: `whatsapp_config.access_token` (`001:195`), `ai_configs.api_key` (`029:12-15`), `webhook_endpoints.secret` (`028:16-19,47`; descifrado en `src/lib/webhooks/deliver.ts:104`).
- Hasheados (no reversibles): tokens de invitación (`invitations.ts:57-59`), API keys (`026:47`, comparación `src/lib/api-keys/keys.ts:86-93`).
- `whatsapp_config.verify_token` en claro (`001:196`).
- Env vars (`.env.local.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (`:18`), `ENCRYPTION_KEY` (`:25`), `META_APP_SECRET` (lista separada por comas, `:38`), `NEXT_PUBLIC_SITE_URL`, `ALLOWED_INVITE_HOSTS`, `AUTOMATION_CRON_SECRET`, `META_APP_ID`, `WHATSAPP_TEMPLATES_DRY_RUN`, `AI_*`.

### 4.2 Propuesta para credenciales por canal

- Tabla separada **`channel_secrets`** (no columnas en `channels`):
  `channel_id PK/FK, account_id, kind ('waha_api_key','mailgun_api_key','mailgun_webhook_signing_key','wa_access_token','waha_webhook_hmac'), ciphertext text, key_version smallint, updated_at`.
  - **Sin políticas SELECT para `authenticated`** (RLS habilitado y sin política = denegado). Escritura solo vía ruta admin (`requireRole('admin')`) que cifra en servidor y usa service role, o vía RPC SECURITY DEFINER que recibe ya el ciphertext. La UI solo muestra "configurado / últimos 4 caracteres".
  - Esto corrige además la exposición actual de ciphertexts a viewers (ver §6).
- Extender `encryption.ts` a formato versionado `v2:<kid>:iv:ct:tag` con keyring `ENCRYPTION_KEYS=kid1:hex,kid2:hex` + `ENCRYPTION_KEY_CURRENT`, y **AAD = `channel_id|kind`** para atar el ciphertext a su fila. Mantener lectura de formatos antiguos.
- Secretos de plataforma (no por canal) en env: `WAHA_BASE_URL` si hay un único servidor WAHA; si cada sesión WAHA puede vivir en un servidor distinto, URL en `channels.config` y API key en `channel_secrets`. Mailgun: la API key y la *HTTP webhook signing key* son por dominio/cuenta Mailgun → `channel_secrets`.
- Webhook URLs de entrada con identificador opaco del canal (`/api/channels/waha/<channel_public_id>/webhook`) para resolver canal antes de verificar firma con su secreto, sin depender de campos del payload.
- Valorar Supabase Vault (`vault.secrets` + `vault.decrypted_secrets`) como alternativa a cifrado en app; hoy el proyecto cifra en Node, mantener coherencia salvo decisión explícita (ADR).

---

## 5. Seguridad de webhooks (patrones reutilizables)

### 5.1 Entrante Meta (`src/lib/whatsapp/webhook-signature.ts`)

- Lee el **cuerpo crudo** con límite de tamaño antes de parsear (`webhook/route.ts:233-237`, `readCappedBody` → 413).
- `x-hub-signature-256: sha256=<hex>`; HMAC-SHA256 del raw body; `timingSafeEqual` con guardia de longitud (`webhook-signature.ts:42-52`).
- Soporta varios secretos (rotación / varias apps) sin cortocircuito (`:54-80`).
- **Fail-closed** si falta el secreto (`:58-66`). Responde 401 para que el proveedor muestre fallos (`webhook/route.ts:240-245`).
- Procesa en `after()` para ack rápido sin perder trabajo en serverless (`webhook/route.ts:269-277`).
- Verificación del `hub.verify_token` con hash + `timingSafeEqual` (`verifyTokenMatches`, `:82-86`).

### 5.2 Saliente propio (`src/lib/webhooks/sign.ts`)

- `X-Wacrm-Signature: t=<unix>,v1=<hex>` sobre `${t}.${rawBody}`, tolerancia 300 s anti-replay (`sign.ts:24-68`).

### 5.3 Crons

- `AUTOMATION_CRON_SECRET` comparado con `timingSafeEqual` (`src/app/api/automations/cron/route.ts:33`, `src/app/api/flows/cron/route.ts:45-52`).

### 5.4 Aplicación a WAHA y Mailgun

- **Mailgun**: el payload trae `signature.timestamp`, `signature.token`, `signature.signature` = HMAC-SHA256(signing_key, timestamp + token). Reutilizar `signatureMatches`-style con `timingSafeEqual`, tolerancia de timestamp (como `sign.ts:59`) y **cache de `token` ya visto** (tabla `webhook_replay_guard(token PK, seen_at)` con TTL) contra replay. Signing key por canal desde `channel_secrets`.
- **WAHA**: WAHA puede firmar con HMAC (cabeceras `X-Webhook-Hmac` / `X-Webhook-Hmac-Algorithm` sha512, configurables por sesión) — confirmar versión desplegada. Usar secreto por sesión, raw body, `timingSafeEqual`. Si la versión no firma: token aleatorio largo en la URL del webhook o cabecera custom, comparado en tiempo constante, + restricción de IP/red privada entre WAHA y la app.
- Común: un módulo `src/lib/channels/webhook-verify.ts` con `verifyHmac({algo, secret, payload, presented, encoding})`, siempre fail-closed, límite de tamaño, 401 en fallo, `after()` para procesamiento, idempotencia por id externo de mensaje (como hace Meta con `message_id`).
- El middleware excluye de 401 solo rutas con `/webhook` bajo `/api/whatsapp/` (`middleware.ts:83-88`); las nuevas rutas bajo `/api/channels/...` no pasan por esa regla, así que cada handler debe autenticar por firma por sí mismo (correcto) — documentarlo.

---

## 6. Riesgos y mejoras

| # | Riesgo / hallazgo | Ref | Recomendación |
|---|---|---|---|
| 1 | Agentes ven y modifican **todas** las conversaciones de la cuenta | `017:414-417`, `:511-518` | Políticas por canal/equipo/asignado (§3.4) — requisito núcleo de Conexa |
| 2 | Un solo número WA por cuenta y una conversación por contacto | `017:319-328`, `036:125` | `channels` + clave `(account_id, channel_id, contact_id)`; migrar `whatsapp_config` a `channels`+`channel_secrets` |
| 3 | Ciphertexts de secretos legibles por cualquier miembro (viewer+) vía PostgREST: `whatsapp_config.access_token`, `ai_configs.api_key`, `webhook_endpoints.secret`; `verify_token` en claro | `017:421`, `029:66`, `028:63`, `001:196` | Mover secretos a tabla sin SELECT para `authenticated`, o `REVOKE SELECT (col)` a nivel de columna |
| 4 | Emails de compañeros visibles a agentes leyendo `profiles` directamente, aunque la API los oculte | `017:612-613` vs `api/account/members/route.ts:53-64` | Vista `account_members_public` sin email o revocar SELECT de columna `email` |
| 5 | `is_account_member(account_id)` se evalúa por fila; `messages` RLS hace join por fila | `017:136-164`, `:511-513` | Helpers sin argumentos envueltos en `(SELECT ...)`, desnormalizar `account_id` en `messages` |
| 6 | Rate limiter en memoria por proceso; inútil con varias instancias | `src/lib/rate-limit.ts:1-21,49` | Redis/Upstash o tabla Postgres si se escala horizontalmente |
| 7 | Middleware solo protege `/api/whatsapp/*`; resto de APIs dependen de cada handler | `src/middleware.ts:83-88` | Test que recorra `src/app/api/**/route.ts` y verifique llamada a `getCurrentAccount/requireRole/requireApiKey/verify*`; renombrar a `proxy.ts` (Next 16) |
| 8 | CSP en modo `Report-Only` con `unsafe-inline` + `unsafe-eval` | `next.config.ts:38-63` | Pasar a enforce; nonce-based; añadir dominios de WAHA/Mailgun solo si el navegador los llama (no debería) |
| 9 | Clave de cifrado única, sin versión ni AAD | `encryption.ts:29-48` | Keyring versionado + AAD por fila (§4.2) |
| 10 | `handle_new_user` traga excepciones → usuarios sin perfil | `017:679-681` | Dejar que falle el signup o registrar en tabla de errores; `getCurrentAccount` ya responde 403 (`account.ts:130-135`) |
| 11 | Cinco clientes service-role duplicados | §1.7 | Unificar en `src/lib/supabase/admin.ts` con `import 'server-only'` |
| 12 | `set_member_role` permite a un admin degradar a otro admin | `047:60-95` | Decidir política; quizás solo owner gestiona admins |
| 13 | Modelo 1 usuario = 1 cuenta | `017:71-74`, `047:309-312` | Suficiente para una sola inmobiliaria; si habrá multi-empresa, migrar a `account_members` real (impacta todos los helpers) |
| 14 | API keys `/api/v1` tienen alcance de cuenta completa con service role | `api-context.ts:108-115` | Añadir scopes de canal o limitar a admin cuando haya visibilidad por equipos |
| 15 | Realtime sin filtros: coste N×eventos con políticas complejas | `src/hooks/use-realtime.ts:48-66` | Políticas baratas o Broadcast por canal/equipo |
| 16 | Webhook Meta resuelve cuenta por `phone_number_id`; con WAHA/Mailgun no hay equivalente aún | `webhook/route.ts:280-303` | `channels UNIQUE(kind, external_id)` + id de canal en la URL del webhook |
| 17 | Sin auditoría de cambios de rol/acceso | — | Tabla `audit_log` escrita desde las RPCs SECURITY DEFINER (rol, canal, equipo) |

### Orden sugerido de implementación

1. `channels` + `channel_secrets` + migración de `whatsapp_config` (sin cambiar visibilidad).
2. `channel_id` en `conversations`/`messages` (+ `account_id` en `messages`), nueva unicidad, índices.
3. Helpers `auth_account_id`, `auth_account_role`, `accessible_channel_ids`, `my_team_ids` con grants correctos.
4. `teams`, `team_members`, `channel_access` + triggers de integridad + UI en settings (extender `members-tab.tsx`).
5. Reescribir políticas de `conversations`, `messages`, `message_reactions`, storage `chat-media`; tests de RLS por rol (siguiendo `src/lib/auth/*-migration.test.ts`).
6. Guardias equivalentes en rutas service-role (`assertConversationInAccount` → `assertUserCanAccessConversation`).
7. Webhooks WAHA/Mailgun con módulo común de verificación.
