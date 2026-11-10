# 00 · Conexa — Visión y alcance del MVP

## Visión
Conexa es el sistema propio de atención y soporte a clientes de la inmobiliaria: **un único inbox** donde los equipos (arriendos, ventas, cartera, mantenimiento, etc.) atienden WhatsApp oficial, WhatsApp no oficial (QR) y correo, con la base técnica lista para incorporar **tickets** (reemplazo de osTicket, con referencias a entidades de Sifinca) y **llamadas** (primero WhatsApp Calling en la web; FreePBX después).

Base: fork de [wacrm](https://github.com/ArnasDon/wacrm) → `github.com/hherrera/wacrm` (MIT). Análisis del código base en [`../analisis/`](../analisis/).

## Objetivo del MVP
Validar Conexa **con uso real** por un grupo piloto de usuarios. Por eso el MVP prioriza estabilidad, trazabilidad y permisos correctos sobre amplitud de funciones.

## Alcance MVP (en orden de ejecución)

| Fase | Entregable | Spec |
|---|---|---|
| **F0 — Reorganización** | Monorepo `apps/web` + `apps/api` + `packages/*`; frontend sin acceso directo de escritura a la BD; capa de dominio y modelo de **canales** genérico; pipeline de ingesta/salida único; cola de trabajos | [01](01-arquitectura-objetivo.md), [02](02-fase0-reorganizacion.md), [03](03-modelo-datos.md) |
| **F1 — WhatsApp Cloud multi-número** | N números (de uno o varios WABA/Apps) por cuenta; plantillas por WABA; inbox muestra el canal | [04](04-canal-whatsapp-cloud.md) |
| **F2 — WhatsApp QR (WAHA)** | Conectar números vía QR, ciclo de vida de sesión, envío/recepción de texto y media, acks | [05](05-canal-waha.md) |
| **F3 — Usuarios y equipos** | Equipos, miembros, canales asignados a equipos/usuarios, visibilidad por RLS, asignación y reglas básicas de enrutamiento | [06](06-usuarios-equipos-enrutamiento.md) |
| **F4 — Email (Mailgun)** | Buzones por dominio/dirección, recepción vía Routes, envío con hilo correcto, log de estado de entrega | [07](07-canal-email-mailgun.md) |
| **Transversal** | Inbox unificado (filtros por canal/equipo/estado, composer por capacidades) | [08](08-inbox-unificado.md) |

Fuera del MVP pero con **arquitectura preparada**: tickets, formularios por tipología, referencias Sifinca, llamadas (WhatsApp Calling, FreePBX) → [09](09-roadmap-tickets-llamadas.md). De las llamadas por WhatsApp el MVP incluye sólo el **diseño y una prueba de concepto**, no la implementación.

Plan, hitos y criterios de aceptación globales → [10](10-plan-entrega.md).

## No-objetivos del MVP
- Broadcasts multicanal (se mantienen sólo WhatsApp Cloud con plantillas, eligiendo número).
- Flows interactivos en WAHA/email (sólo Cloud; en otros canales no se disparan).
- App móvil, chat web/widget, Instagram/Facebook.
- SLA formales (llegan con tickets).
- Multi-empresa: hay una sola cuenta (la inmobiliaria). La tenencia por `account_id` se conserva pero no se explota.

## Criterios de éxito del piloto
1. 100% de los mensajes entrantes de los canales conectados aparecen en el inbox en < 5 s, sin duplicados.
2. Cada agente ve **sólo** las conversaciones de los canales/equipos que le corresponden (verificado por pruebas de RLS).
3. Un correo respondido desde Conexa llega al cliente en el **mismo hilo** de su cliente de correo y su estado (entregado/fallido/abierto) se ve en el mensaje.
4. Una sesión WAHA caída se detecta y se notifica en < 5 min.
5. Tiempo de primera respuesta y volumen por canal/equipo visibles en el dashboard.

## Glosario
| Término | Significado |
|---|---|
| Canal | Un punto de contacto concreto: un número WA Cloud, una sesión WAHA, un buzón de correo. Tabla `channels`. |
| Conversación | Hilo entre un contacto y un canal (en email: un hilo de correo). |
| Identidad | Forma de reconocer a un contacto en un canal: teléfono, BSUID, chatId WAHA, email. |
| Equipo | Grupo de usuarios (p. ej. "Arriendos"); recibe canales y conversaciones. |
| Ticket / caso | (post-MVP) Unidad de trabajo con tipología, formulario, estado y SLA, enlazada a conversaciones y entidades Sifinca. |
