# 08 · Inbox unificado (transversal)

Base: [análisis 04](../analisis/04-inbox-tiempo-real-asignacion.md) (25 puntos acoplados a WhatsApp).

## Principio
Una sola bandeja; la **conversación** sabe su canal; el **composer y el hilo se adaptan a las capacidades** del canal (`ChannelCapabilities` en `packages/shared`). Nada en la UI pregunta "¿es WhatsApp?"; pregunta "¿el canal soporta X?".

## Lista de conversaciones
- Datos desde `GET /v1/conversations` (paginación por cursor `last_message_at,id`, 50 por página, scroll infinito). Filtros en servidor: vista (mías/sin asignar/equipo/todas), canal(es), tipo de canal, estado, etiqueta, búsqueda (nombre, teléfono, email, asunto).
- Cada fila: avatar, nombre, **badge de canal** (icono por tipo + nombre del canal), asunto (email) o último mensaje, hora, no leídos **por usuario** (`conversation_reads`), asignado, equipo.
- Realtime: mismo hook (`use-realtime`) pero las actualizaciones se *mezclan* en la página cargada; conversaciones nuevas se insertan si cumplen el filtro activo.

## Hilo
- Burbujas por `content_type`: existentes + `email` (cabecera con De/Para/CC/asunto, cuerpo HTML saneado en contenedor aislado, colapsar citas, adjuntos) + `note` (nota interna, fondo distinto, nunca se envía) + `system` (eventos: asignado, transferido, cerrado).
- Indicador de estado por canal: ticks (WA Cloud/WAHA) o estado email con historial (`message_delivery_events`).
- Mensajes enviados desde el celular (WAHA) marcados "desde teléfono".

## Composer
| Capacidad | Efecto |
|---|---|
| `replyWindowHours` | Banner "ventana cerrada" + sólo plantillas (validado también en servidor) |
| `templates` | Botón de plantillas (filtradas por WABA del canal) |
| `interactive` | Botones/listas/quick replies interactivas |
| `subject`/`html`/`cc` | **Composer de email**: asunto (prefijado "Re:"), CC, editor enriquecido básico, firma |
| `voiceNotes` | Grabación de voz |
| `maxAttachments`/`maxMediaBytes` | Validación de adjuntos |
| — | Modo **nota interna** disponible en todos los canales |

Respuestas rápidas (`quick_replies`) válidas en todos los canales; las de tipo `interactive` sólo donde `interactive=true`.

## Contacto (panel lateral)
- Identidades del contacto (teléfonos, emails, WA) y **todas sus conversaciones en todos los canales** (historial unificado del cliente) con salto rápido.
- Iniciar conversación saliente: elegir canal permitido (WA Cloud → plantilla obligatoria; WAHA → texto, con aviso de riesgo; email → asunto + cuerpo).
- Placeholder (post-MVP): tickets y referencias Sifinca del contacto.

## Acciones de conversación (vía `PATCH /v1/conversations/:id`)
Estado (abierta/pendiente/cerrada), asignar, transferir equipo, prioridad, etiquetas; todas auditadas en `conversation_events` y visibles como mensajes `system` en el hilo.

## Aceptación
1. Con 5.000 conversaciones la lista carga en < 1 s y pagina sin cortes.
2. Una conversación de email y una de WhatsApp del mismo contacto se ven en la lista con badges distintos y se abren con el composer correspondiente.
3. No leídos son por usuario: si A abre la conversación, B la sigue viendo como no leída.
4. Notas internas nunca salen por ningún canal (test de `sendToConversation`).
