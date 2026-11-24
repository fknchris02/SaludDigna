# Catálogo de eventos

Cada evento se guarda en `Event` (append-only) con `seq`, `channel`, `caseId`, `patientId`, `actorId` y `createdAt`. Fuente: [`lib/engine/events.ts`](../lib/engine/events.ts).

| Evento | Cuándo | Payload |
|---|---|---|
| `IDENTITY_ANONYMOUS_CREATED` | Primer contacto de un visitante en un canal | `identityId` |
| `OTP_SENT` | Se genera un código | `telefono` enmascarado |
| `OTP_FAILED` | Código o fecha de nacimiento incorrectos | `attempt` / `method`, `identityId` |
| `IDENTITY_VERIFIED` | Verificación exitosa | `method`: OTP \| BIRTHDATE |
| `IDENTITY_LINKED` | La identidad del canal se liga al paciente | `identityId`, `channel`, `casesLinked` |
| `CASE_CREATED` | Nuevo trámite | `tipo` |
| `CASE_RESUMED` | El trámite continúa en un canal distinto al último | `from`, `to`, `step` |
| `STEP_COMPLETED` | Avance (o corrección) de paso | `from`, `to`, `data` |
| `APPOINTMENT_CONFIRMED` | Cita confirmada | `from`, `to`, `data.folio` |
| `CASE_CANCELLED` | Trámite cancelado | `from`, `to`, `data.motivoCancelacion` |
| `CONFLICT_DETECTED` | Escritura rechazada por versión vieja | `expectedVersion`, `currentVersion`, `to` |
| `MESSAGE_IN` / `MESSAGE_OUT` | Mensaje de/para el paciente (WhatsApp) | `text` *(pendiente)* |
| `INTENT_CLASSIFIED` | La IA (o el fallback) clasificó un mensaje | `intent`, `source` *(pendiente)* |
| `ADVISOR_OPENED_CASE` | Un asesor abrió el expediente (auditoría) | `actorId` *(pendiente)* |

*(pendiente)* = definido en el catálogo; lo emiten los módulos de canales/asesor que aún no se construyen.
