# 03 · Modelo de datos (cambios del MVP)

Se **extiende** el esquema de wacrm (migraciones 001–059). Convenciones existentes que se respetan: `account_id` en toda tabla de negocio, RLS habilitado, `updated_at` por trigger, RPCs `SECURITY DEFINER` con `search_path` fijado, índices únicos como respaldo de idempotencia.

## 1. Canales

```sql
CREATE TYPE channel_type AS ENUM ('whatsapp_cloud','whatsapp_waha','email_mailgun'); -- 'voice_freepbx' luego
CREATE TYPE channel_status AS ENUM ('pending','connected','disconnected','error');

CREATE TABLE channels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type          channel_type NOT NULL,
  name          text NOT NULL,                 -- "Arriendos WA", "soporte@…"
  address       text NOT NULL,                 -- E.164, chatId propio o email: lo que ve el cliente
  status        channel_status NOT NULL DEFAULT 'pending',
  status_detail text,                          -- último error / estado del proveedor
  config        jsonb NOT NULL DEFAULT '{}',   -- NO secretos (ids, flags, firma, horario…)
  default_team_id uuid,                        -- enrutamiento por defecto (F3); FK a teams se añade en 065
  created_by    uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  UNIQUE (type, address)                       -- un número/buzón no se registra dos veces
);

CREATE TABLE channel_secrets (                 -- sin políticas para authenticated: sólo service role
  channel_id uuid PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  secrets    text NOT NULL,                    -- JSON cifrado AES-256-GCM (encryption.ts), AAD = channel_id
  key_version smallint NOT NULL DEFAULT 1,
  updated_at timestamptz DEFAULT now()
);
```

`config` por tipo (validado con zod en `packages/shared`):

| Tipo | `config` | `channel_secrets` |
|---|---|---|
| `whatsapp_cloud` | `phone_number_id`, `waba_id`, `display_phone`, `mirror_inbound_media`, `registered_at`, `subscribed_apps_at` | `access_token`, `verify_token`, `pin` |
| `whatsapp_waha` | `waha_base_url`, `session_name`, `engine`, `me` (jid propio), `last_status` | `api_key`, `webhook_hmac_key` |
| `email_mailgun` | `domain`, `region` (`us`/`eu`), `from_name`, `from_address`, `reply_to_mode`, `tracking_opens`, `signature_html` | `api_key`, `webhook_signing_key` |

`whatsapp_config` se conserva durante F0 como vista de compatibilidad sobre `channels` + `channel_secrets` y se elimina en 0.6.

## 2. Identidades de contacto

```sql
CREATE TYPE identity_kind AS ENUM ('phone','wa_bsuid','waha_lid','email');

CREATE TABLE contact_identities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  kind        identity_kind NOT NULL,
  value       text NOT NULL,           -- tal como llegó
  value_norm  text NOT NULL,           -- dígitos E.164 / email lower-trim / lid
  is_primary  boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (account_id, kind, value_norm)
);
ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;
```

- Resolver único `resolveContact(accountId, identities[])`: busca por cualquiera de las identidades; si no existe, crea contacto + identidades; si encuentra dos contactos distintos, **no fusiona automáticamente**: usa el primero y registra sugerencia de fusión (`contact_merge_suggestions`).
- `contacts.phone` / `contacts.email` se mantienen como "principales" (lectura de UI/API) sincronizados por trigger desde la identidad `is_primary`.
- WAHA: `57300…@c.us` → `phone`; `…@lid` → `waha_lid` (+ resolver a teléfono con `GET /api/{s}/lids/{lid}` cuando se pueda).

## 3. Conversaciones

```sql
ALTER TABLE conversations
  ADD COLUMN channel_id uuid REFERENCES channels(id),
  ADD COLUMN thread_key text NOT NULL DEFAULT '',     -- '' en chat; id raíz del hilo en email
  ADD COLUMN subject text,                            -- email
  ADD COLUMN team_id uuid,                            -- F3 (FK a teams en 065)
  ADD COLUMN first_response_at timestamptz,           -- métrica
  ADD COLUMN priority smallint NOT NULL DEFAULT 0;

DROP INDEX idx_conversations_account_contact;                       -- (036)
CREATE UNIQUE INDEX idx_conversations_channel_contact_thread
  ON conversations (channel_id, contact_id, thread_key);
CREATE INDEX idx_conversations_inbox
  ON conversations (account_id, status, last_message_at DESC);
CREATE INDEX idx_conversations_team ON conversations (team_id, status, last_message_at DESC);
```

Regla: **chat** (Cloud/WAHA) → una conversación por (canal, contacto), se reabre al recibir. **Email** → una por hilo (`thread_key` = Message-Id raíz); un correo nuevo sin referencias abre conversación nueva.

`conversation_events` (auditoría — base de SLA y tickets):
```sql
CREATE TABLE conversation_events (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL, conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('user','system','automation','ai')),
  actor_id uuid,
  type text NOT NULL,   -- status_changed | assigned | team_changed | channel_reply | priority_changed
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
```

`conversation_reads (conversation_id, user_id, last_read_at)` → no leídos por usuario.

## 4. Mensajes

```sql
ALTER TABLE messages
  ADD COLUMN account_id uuid,                 -- desnormalizado para RLS barata
  ADD COLUMN channel_id uuid REFERENCES channels(id),
  ADD COLUMN direction text CHECK (direction IN ('in','out','internal')),
  ADD COLUMN subject text,
  ADD COLUMN body_html text,                  -- email (sanitizado al renderizar)
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';   -- headers email, waha source, cc/bcc, etc.
-- message_id se conserva como "external_id" (wamid / id WAHA / Message-Id). Se expone como external_id en la API.
ALTER TABLE messages DROP CONSTRAINT messages_content_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_content_type_check CHECK (content_type IN
  ('text','image','document','audio','video','location','template','interactive','email','note','sticker','system'));
ALTER TABLE messages DROP CONSTRAINT messages_status_check;
ALTER TABLE messages ADD CONSTRAINT messages_status_check CHECK (status IN
  ('queued','sending','sent','delivered','read','failed','received'));

CREATE TABLE message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  storage_path text NOT NULL, filename text, mime_type text, size_bytes bigint,
  content_id text,            -- imágenes inline en email (cid:)
  created_at timestamptz DEFAULT now()
);

CREATE TABLE message_delivery_events (       -- log de estado (requisito email; útil para todos)
  id bigserial PRIMARY KEY,
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL, external_id text NOT NULL,
  event text NOT NULL,        -- accepted, delivered, failed, opened, clicked, complained, ack:3 …
  severity text, reason text, raw jsonb, occurred_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (channel_id, external_id, event, occurred_at)
);
```

`messages.status` sigue siendo el estado resumido (monotónico, `message-status.ts`); `message_delivery_events` guarda **todo** el historial.

## 5. Eventos crudos entrantes (idempotencia y reproceso)

```sql
CREATE TABLE inbound_events (
  id bigserial PRIMARY KEY,
  channel_id uuid REFERENCES channels(id),
  provider text NOT NULL,                    -- meta | waha | mailgun
  dedupe_key text NOT NULL,                  -- wamid / waha id / Message-Id+recipient / event id
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','failed','ignored')),
  error text, attempts int NOT NULL DEFAULT 0,
  received_at timestamptz DEFAULT now(), processed_at timestamptz,
  UNIQUE (provider, dedupe_key)
);
```
Retención: 30 días (job de limpieza).

## 6. Equipos y acceso (F3)

```sql
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL, description text, color text,
  assignment_mode text NOT NULL DEFAULT 'manual' CHECK (assignment_mode IN ('manual','round_robin')),
  created_at timestamptz DEFAULT now(), UNIQUE (account_id, name)
);
CREATE TABLE team_members (
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member','lead')),
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE channel_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  CHECK ((team_id IS NULL) <> (user_id IS NULL)),
  UNIQUE (channel_id, team_id), UNIQUE (channel_id, user_id)
);
```
Funciones y políticas en [06](06-usuarios-equipos-enrutamiento.md).

## 7. Preparación para fases posteriores (sólo reservar, no implementar)
- `conversations.ticket_id` **no** se añade aún: la relación será `ticket_conversations (ticket_id, conversation_id)` N:M — ver [09](09-roadmap-tickets-llamadas.md).
- `channel_type` admite agregar `voice_freepbx`; `messages.content_type` admite `'call'` en el futuro.
- `external_refs` genérico (para Sifinca) se define en la fase de tickets.

## 8. Migraciones (orden)
`060_channels.sql` (tablas + backfill + vista compat) → `061_contact_identities.sql` (+ backfill) → `062_conversation_channel.sql` (columnas + backfill, sin cambiar unicidad) → `063_messages_multichannel.sql` → `064_inbound_events.sql` → `065_teams_access.sql` + RLS → `066_harden_channels.sql` (NOT NULL, nueva unicidad, quitar UNIQUE(account_id)).
Cada migración idempotente y verificada por `packages/db/ci/verify-schema.sql`.
