# ADR-001 · Monorepo con frontend (Next.js) y backend (Fastify) separados

- Estado: **aceptado** (2026-11-09, decisión del usuario)

## Contexto
wacrm es una única app Next.js: UI, 56 route handlers, webhooks, motores y crons en el mismo proceso; el navegador lee y escribe directo en Supabase desde 48 archivos. Conexa necesita: varios canales con webhooks propios, procesos de larga duración y colas (sesiones WAHA, reconciliación Mailgun, puente AMI de FreePBX, transcripciones) y reglas de negocio centralizadas (permisos por equipo, auditoría, SLA). `after()` y crons externos de Next no son una base sólida para eso.

## Opciones
1. Una app Next con capas estrictas (`src/server`, `src/client`).
2. **Monorepo `apps/web` (Next) + `apps/api` (Node) + `packages/shared` + `packages/db`.**

## Decisión
Opción 2, con **Fastify + zod** para la API, npm workspaces, pg-boss para trabajos. El navegador sólo usa Supabase para Auth y Realtime; todo lo demás va por la API.

## Consecuencias
- (+) Límite explícito frontend/backend; contratos tipados compartidos; workers reales; webhooks en un servicio estable.
- (+) La API puede escalar/desplegarse distinto de la web.
- (−) Refactor inicial grande (Fase 0) y divergencia del upstream.
- (−) Dos servicios que desplegar (mitigado con Docker Compose).
