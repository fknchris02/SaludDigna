# Catálogo de eventos

Cada evento se guarda en `Event` (append-only) con `seq`, `channel`, `caseId`, `patientId`, `actorId` y `createdAt`. Fuente: [`lib/engine/events.ts`](../lib/engine/events.ts).

| Evento | Cuándo | Payload |
|---|---|---|
| `IDENTITY_ANONYMOUS_CREATED` | Primer contacto de un visitante en un canal | `identityId` |
| `OTP_SENT` | Se genera un código | `telefono` enmascarado |
| `OTP_FAILED` | Código, fecha de nacimiento o validación del asesor incorrectos | `attempt` / `method`, `identityId`; `actorId` si fue un asesor |
| `IDENTITY_VERIFIED` | Verificación exitosa | `method`: OTP \| BIRTHDATE \| WHATSAPP_NUMBER (registro nuevo) \| ASESOR_2_DATOS (`actorId` = asesor) |
| `IDENTITY_LINKED` | La identidad del canal se liga al paciente | `identityId`, `channel`, `casesLinked` |
| `CASE_CREATED` | Nuevo trámite | `tipo` |
| `CASE_RESUMED` | El trámite continúa en un canal distinto al último | `from`, `to`, `step` |
| `STEP_COMPLETED` | Avance (o corrección) de paso | `from`, `to`, `data` |
| `APPOINTMENT_CONFIRMED` | Cita confirmada | `from`, `to`, `data.folio` |
| `CASE_CANCELLED` | Trámite cancelado | `from`, `to`, `data.motivoCancelacion` |
| `CONFLICT_DETECTED` | Escritura rechazada por versión vieja | `expectedVersion`, `currentVersion`, `to` |
| `PATIENT_UPDATED` | El asesor capturó los datos de un prospecto sin fecha de nacimiento (`actorId` = asesor) | `campos` |
| `MESSAGE_IN` / `MESSAGE_OUT` | Mensaje de/para el paciente (WhatsApp); la fecha de nacimiento se guarda como `[fecha de nacimiento]` | `identityId`, `text`, `options` |
| `INTENT_CLASSIFIED` | Se actuó sobre una intención (cancelar, asesor, preguntas) o la IA eligió una opción por texto libre | `intent` (incl. `ELEGIR_OPCION` + `option`), `source`: rules \| llm |
| `ADVISOR_OPENED_CASE` | Personal abrió el expediente (auditoría, máx. 1 cada 10 min por persona y paciente); `actorId` = quién | `role` |
