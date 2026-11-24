# Catálogo de eventos

Cada evento se guarda en `Event` (append-only) con `seq`, `channel`, `caseId`, `patientId`, `actorId` y `createdAt`. Fuente: [`lib/engine/events.ts`](../lib/engine/events.ts).

| Evento | Cuándo | Payload |
|---|---|---|
| `IDENTITY_ANONYMOUS_CREATED` | Primer contacto de un visitante en un canal | `identityId` |
| `OTP_SENT` | Se genera un código | `telefono` enmascarado |
| `OTP_FAILED` | Código o fecha de nacimiento incorrectos | `attempt` / `method`, `identityId` |
| `IDENTITY_VERIFIED` | Verificación exitosa | `method`: OTP \| BIRTHDATE \| WHATSAPP_NUMBER (registro nuevo) |
| `IDENTITY_LINKED` | La identidad del canal se liga al paciente | `identityId`, `channel`, `casesLinked` |
| `CASE_CREATED` | Nuevo trámite | `tipo` |
| `CASE_RESUMED` | El trámite continúa en un canal distinto al último | `from`, `to`, `step` |
| `STEP_COMPLETED` | Avance (o corrección) de paso | `from`, `to`, `data` |
| `APPOINTMENT_CONFIRMED` | Cita confirmada | `from`, `to`, `data.folio` |
| `CASE_CANCELLED` | Trámite cancelado | `from`, `to`, `data.motivoCancelacion` |
| `CONFLICT_DETECTED` | Escritura rechazada por versión vieja | `expectedVersion`, `currentVersion`, `to` |
| `MESSAGE_IN` / `MESSAGE_OUT` | Mensaje de/para el paciente (WhatsApp); la fecha de nacimiento se guarda como `[fecha de nacimiento]` | `identityId`, `text`, `options` |
| `INTENT_CLASSIFIED` | Se actuó sobre una intención (cancelar, asesor, preguntas) | `intent`, `source`: rules \| llm |
| `ADVISOR_OPENED_CASE` | Personal abrió el expediente (auditoría); `actorId` = quién | `role` |
