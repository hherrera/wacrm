# 10 · Plan de entrega del MVP

Desglose por PR, calendario, migraciones e infraestructura: [**PLAN-MVP**](../PLAN-MVP.md).

## Hitos
| Hito | Contenido | Depende de | Demo de cierre |
|---|---|---|---|
| **H0.1** Monorepo ✅ | Etapa 0.1 + 0.2 ([02](02-fase0-reorganizacion.md)) | — | CI verde, `apps/api /health` y `/docs` |
| **H0.2** Canales, colas y pipelines | Etapas 0.3 + 0.4 (migraciones 061–067, colas pg-boss según [11](11-colas-y-trabajos.md), ingest/outbound, webhook Meta en api, motores y crons en pg-boss, **bucket privado + URLs firmadas + `media.mirror`** según [12](12-multimedia-transcripciones.md)) | H0.1 | WhatsApp Cloud funcionando igual que wacrm, servido por `apps/api` |
| **H0.3** Frontend desacoplado | Etapa 0.5 (inbox primero) + 0.6 | H0.2 | Cero `.from(` en `apps/web` |
| **H1** WA Cloud multi-número | [04](04-canal-whatsapp-cloud.md) | H0.2 (puede solaparse con H0.3) | 2 números, 2 WABA |
| **H2** WAHA | [05](05-canal-waha.md) | H0.2 | QR → conversación |
| **H2.5** Transcripción de notas de voz | [12](12-multimedia-transcripciones.md) §4 | H2 | Nota de voz → texto en < 30 s y respuesta IA a su contenido |
| **H3** Equipos | [06](06-usuarios-equipos-enrutamiento.md), migración 071 | H0.3 | Visibilidad por equipo con tests RLS |
| **H4** Email | [07](07-canal-email-mailgun.md) | H0.2, H3 | Hilo Gmail ida y vuelta + log de estados |
| **H5** Inbox unificado + piloto | [08](08-inbox-unificado.md), dashboard por canal/equipo, hardening, runbooks | H1–H4 | Piloto con usuarios reales |

Orden: H0.1 → H0.2 → (H0.3 ∥ H1 → H2 → H2.5) → H3 → H4 → H5. Equipo de **2 desarrolladores**, en **fases de 2 semanas**: 11 fases, 22 semanas con el piloto. H0.2 = fases 1–3 · H0.3 = 4–7 · H1 = 4–5 · H2 = 5–6 · H2.5 = 7 · H3 = 7–8 · H4 = 8–9 · H5 = 10–11. Detalle por fase en [PLAN-MVP §1](../PLAN-MVP.md#1-ruta-y-calendario).

## Criterios transversales ("definición de terminado")
- Tests Vitest de la lógica nueva (parsers de webhook con payloads reales grabados, mapeos de estado, threading, RLS por rol).
- Contratos en `packages/shared`; OpenAPI actualizado.
- Migración SQL idempotente + verificación en CI.
- i18n: textos en `messages/es.json` (idioma por defecto de Conexa) y `en.json`.
- Webhooks: firma verificada, evento crudo persistido, idempotentes.
- Sin secretos en `channels.config` ni en logs.
- Runbook en `docs/conexa/runbooks/` para cada canal (alta, errores frecuentes, recuperación).

## Entorno
| Componente | MVP |
|---|---|
| Supabase | **Supabase Cloud** (decidido 2026-11-09). El proyecto actual (`us-west-2`) es sólo de **prototipo** y puede reemplazarse; el de producción se crea antes de cargar datos reales, con región por definir (recomendada: `sa-east-1`, São Paulo, la más cercana a Colombia). Plan Pro (backups diarios, sin pausa por inactividad). |
| web + api + worker + WAHA | Docker Compose en un VPS (4 vCPU / 8 GB para el piloto), proxy TLS (Caddy) |
| Dominio | `conexa.<empresa>.com` (web), `api.conexa.<empresa>.com` (api + webhooks) |
| Mailgun | Subdominio verificado (SPF, DKIM, MX), región a decidir |
| Meta | App(s) existentes, System User token por WABA |
| Observabilidad | Logs estructurados (pino de Fastify), `/health` por servicio, alertas de canal caído vía notificaciones in-app + email |

## Decisiones abiertas (requieren al negocio/TI)
1. ~~Supabase cloud vs self-hosted~~ → **Cloud** (2026-11-09).
2. Qué números pasan a Cloud API y cuáles quedan en WAHA; aceptación formal del riesgo WAHA.
3. Buzones de email del piloto y si se cambia MX o se usa reenvío.
4. Equipos del piloto y sus canales.
5. ~~Confirmar Drizzle~~ → **aceptado** ([ADR-003](../adr/ADR-003-acceso-datos-drizzle.md)).
6. Acceso a Sifinca (API vs BD) — necesario sólo para la fase de tickets.
7. Autorización de tratamiento de datos para transcripción en la nube (Ley 1581) o motor self-hosted — antes de H2.5.
8. Usuarios del piloto y fecha de arranque — antes de H5.

Decisiones técnicas ya tomadas el 2026-11-10 (Graph API v25.0, envío con `messages.mime`, `message_id`/`external_id`, `priority`, `WHATSAPP_FILES_LIFETIME`, alcance de llamadas, equipo y fases): [PLAN-MVP §5](../PLAN-MVP.md), D9–D16.

## Riesgos principales
| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| F0 se alarga (refactor grande) | Media | Alto | Strangler por módulo, tests portados, no reescribir lógica |
| Bloqueo de números WAHA | Media | Medio | Sólo conversaciones iniciadas por cliente, limitador, sin broadcasts; números Cloud para lo crítico |
| Hilos de email rotos por clientes de correo raros | Media | Medio | Threading en 4 niveles + token en Reply-To |
| Rendimiento RLS con equipos | Baja | Alto | Funciones en `(SELECT …)`, desnormalización, índices, prueba de carga con 50k mensajes |
| Divergencia con upstream wacrm | Alta | Bajo | Aceptada; cherry-pick sólo de fixes de seguridad/Meta |
