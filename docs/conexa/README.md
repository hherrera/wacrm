# Conexa — documentación de trabajo

Sistema de atención y soporte multicanal de la inmobiliaria, construido sobre un fork de [wacrm](https://github.com/ArnasDon/wacrm) (`origin` = `hherrera/wacrm`, `upstream` = `ArnasDon/wacrm`).
Los documentos de `docs/*.md` fuera de esta carpeta son del proyecto original.

## Análisis del código base (wacrm @ c81299d)
| # | Documento |
|---|---|
| 01 | [Arquitectura general](analisis/01-arquitectura-general.md) |
| 02 | [Modelo de datos y canal WhatsApp Cloud](analisis/02-modelo-datos-y-canal-whatsapp.md) |
| 03 | [Cuentas, roles y seguridad](analisis/03-cuentas-roles-seguridad.md) |
| 04 | [Inbox, tiempo real y asignación](analisis/04-inbox-tiempo-real-asignacion.md) |
| 05 | [Automatizaciones, flows, IA, broadcasts y API](analisis/05-automatizaciones-flows-ia-broadcasts-api.md) |
| 06 | [**Mejoras para soportar multicanal** (síntesis)](analisis/06-mejoras-extensibilidad-multicanal.md) |

## Investigación de integraciones
[WAHA](investigacion/waha.md) · [Mailgun](investigacion/mailgun.md) · [FreePBX](investigacion/freepbx.md) · [osTicket](investigacion/osticket.md) · [Docs y blog de wacrm](investigacion/wacrm-docs-blog.md)

## Spec del MVP
| # | Documento | Fase |
|---|---|---|
| 00 | [Visión y alcance](spec/00-vision-alcance-mvp.md) | — |
| 01 | [Arquitectura objetivo](spec/01-arquitectura-objetivo.md) | F0 |
| 02 | [Fase 0: reorganización frontend/backend](spec/02-fase0-reorganizacion.md) | F0 |
| 03 | [Modelo de datos](spec/03-modelo-datos.md) | F0–F4 |
| 04 | [WhatsApp Cloud multi-número](spec/04-canal-whatsapp-cloud.md) | F1 |
| 05 | [WhatsApp QR (WAHA)](spec/05-canal-waha.md) | F2 |
| 06 | [Usuarios, equipos y enrutamiento](spec/06-usuarios-equipos-enrutamiento.md) | F3 |
| 07 | [Email (Mailgun)](spec/07-canal-email-mailgun.md) | F4 |
| 08 | [Inbox unificado](spec/08-inbox-unificado.md) | transversal |
| 09 | [Roadmap: tickets y llamadas](spec/09-roadmap-tickets-llamadas.md) | post-MVP |
| 10 | [Plan de entrega, decisiones abiertas y riesgos](spec/10-plan-entrega.md) | — |

## Decisiones de arquitectura (ADR)
| ADR | Decisión | Estado |
|---|---|---|
| [001](adr/ADR-001-monorepo-web-api.md) | Monorepo `apps/web` (Next) + `apps/api` (Fastify + zod) | Aceptado |
| [002](adr/ADR-002-canales-y-adaptadores.md) | Canales + adaptadores + pipelines únicos | Propuesto |
| [003](adr/ADR-003-acceso-datos-drizzle.md) | Drizzle ORM sobre migraciones SQL | Propuesto |
| [004](adr/ADR-004-cola-pg-boss.md) | Trabajos asíncronos con pg-boss | Propuesto |
| [005](adr/ADR-005-waha.md) | WhatsApp no oficial con WAHA | Propuesto |
