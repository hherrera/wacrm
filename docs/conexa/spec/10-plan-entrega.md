# 10 · Plan de entrega del MVP

## Hitos
| Hito | Contenido | Depende de | Demo de cierre |
|---|---|---|---|
| **H0.1** Monorepo | Etapa 0.1 + 0.2 ([02](02-fase0-reorganizacion.md)) | — | CI verde, `apps/api /health` y `/docs` |
| **H0.2** Canales y pipelines | Etapas 0.3 + 0.4 (migraciones 060–064, ingest/outbound, webhook Meta en api, motores y crons en pg-boss) | H0.1 | WhatsApp Cloud funcionando igual que wacrm, servido por `apps/api` |
| **H0.3** Frontend desacoplado | Etapa 0.5 (inbox primero) + 0.6 | H0.2 | Cero `.from(` en `apps/web` |
| **H1** WA Cloud multi-número | [04](04-canal-whatsapp-cloud.md) | H0.2 (puede solaparse con H0.3) | 2 números, 2 WABA |
| **H2** WAHA | [05](05-canal-waha.md) | H0.2 | QR → conversación |
| **H3** Equipos | [06](06-usuarios-equipos-enrutamiento.md), migración 065 | H0.3 | Visibilidad por equipo con tests RLS |
| **H4** Email | [07](07-canal-email-mailgun.md) | H0.2, H3 | Hilo Gmail ida y vuelta + log de estados |
| **H5** Inbox unificado + piloto | [08](08-inbox-unificado.md), dashboard por canal/equipo, hardening, runbooks | H1–H4 | Piloto con usuarios reales |

Orden recomendado: H0.1 → H0.2 → (H0.3 ∥ H1) → H2 → H3 → H4 → H5.

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
| Supabase | **Decisión abierta:** cloud (más simple; región `us-east-1`/`sa-east-1`) vs self-hosted (datos en infraestructura propia). |
| web + api + worker + WAHA | Docker Compose en un VPS (4 vCPU / 8 GB para el piloto), proxy TLS (Caddy) |
| Dominio | `conexa.<empresa>.com` (web), `api.conexa.<empresa>.com` (api + webhooks) |
| Mailgun | Subdominio verificado (SPF, DKIM, MX), región a decidir |
| Meta | App(s) existentes, System User token por WABA |
| Observabilidad | Logs estructurados (pino de Fastify), `/health` por servicio, alertas de canal caído vía notificaciones in-app + email |

## Decisiones abiertas (requieren al negocio/TI)
1. Supabase cloud vs self-hosted.
2. Qué números pasan a Cloud API y cuáles quedan en WAHA; aceptación formal del riesgo WAHA.
3. Buzones de email del piloto y si se cambia MX o se usa reenvío.
4. Equipos del piloto y sus canales.
5. Confirmar Drizzle ([ADR-003](../adr/ADR-003-acceso-datos-drizzle.md)).
6. Acceso a Sifinca (API vs BD) — necesario sólo para la fase de tickets.

## Riesgos principales
| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| F0 se alarga (refactor grande) | Media | Alto | Strangler por módulo, tests portados, no reescribir lógica |
| Bloqueo de números WAHA | Media | Medio | Sólo conversaciones iniciadas por cliente, limitador, sin broadcasts; números Cloud para lo crítico |
| Hilos de email rotos por clientes de correo raros | Media | Medio | Threading en 4 niveles + token en Reply-To |
| Rendimiento RLS con equipos | Baja | Alto | Funciones en `(SELECT …)`, desnormalización, índices, prueba de carga con 50k mensajes |
| Divergencia con upstream wacrm | Alta | Bajo | Aceptada; cherry-pick sólo de fixes de seguridad/Meta |
