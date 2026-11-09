# Conexa — monorepo

Fork of wacrm being turned into a multichannel support system. Specs and decisions: `docs/conexa/README.md`.

| Path | What |
|---|---|
| `apps/web` | Next.js 16 UI (the original wacrm app). Read `apps/web/AGENTS.md` before touching Next code. |
| `apps/api` | Fastify backend (webhooks, channels, workers). Grows module by module — see `docs/conexa/spec/02-fase0-reorganizacion.md`. |
| `packages/shared` | zod contracts shared by web and api. |
| `packages/db` | Supabase SQL migrations (`supabase/migrations`, source of truth). New migrations continue the numbering (061…; 060 = grants). |
| `infra` | docker-compose (web + api). |
| `mcp-server` | Upstream MCP server, not a workspace yet. |

Commands from the repo root: `npm run dev:web`, `npm run dev:api`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
