# Flujo de datos: el recorrido de Ana

```mermaid
sequenceDiagram
  autonumber
  actor Ana
  participant W as Web
  participant WA as WhatsApp
  participant CC as Asesor (Call Center)
  participant APP as App
  participant M as Motor de Contexto
  participant DB as PostgreSQL
  participant A as Admin (SSE)

  Ana->>W: Verifica su teléfono (OTP)
  W->>M: getOrCreateChannelIdentity(WEB, cookie) · verifyAndLink
  M->>DB: identidad web ligada a Ana
  Ana->>W: Cotiza ultrasonido
  W->>M: createCase + advance(ESTUDIO_ELEGIDO)
  M->>DB: Case v2 + Event STEP_COMPLETED (ya es de Ana)
  M-->>A: evento en vivo
  Ana->>W: Elige clínica
  W->>M: advance(CLINICA_ELEGIDA)
  Note over Ana,W: Cierra la computadora (trámite queda en CLINICA_ELEGIDA)

  Ana->>WA: "Hola"
  WA->>M: identidad por número + fecha de nacimiento
  WA->>M: getActiveCase(Ana) → pendingStep = HORARIO_ELEGIDO
  WA->>M: resumeCase(WHATSAPP)
  M->>DB: Event CASE_RESUMED {from: WEB, to: WHATSAPP}
  WA-->>Ana: "Tienes un ultrasonido en Clínica Centro, ¿elegimos horario?"
  Ana->>WA: Elige horario (MessageSid = llave de idempotencia)
  WA->>M: advance(HORARIO_ELEGIDO, expectedVersion=3)

  Ana->>CC: Llama con una duda
  CC->>M: abre expediente → Event ADVISOR_OPENED_CASE (auditoría)
  M-->>CC: contexto + línea de tiempo + resumen IA
  CC->>M: advance(DATOS_CONFIRMADOS) → advance(CITA_CONFIRMADA)
  M->>DB: folio SD-XXXX, Event APPOINTMENT_CONFIRMED

  Ana->>APP: Login OTP
  APP->>M: getActiveCase / historial
  M-->>APP: cita confirmada
```

## Validación en cada cambio de canal

1. **¿Quién es?** El canal resuelve `ChannelIdentity` → `Patient` (verificado o no).
2. **¿Qué tiene pendiente?** `getActiveCase` + `pendingStep`.
3. **¿Puede avanzar?** `advance` valida transición, datos (zod) y versión, todo en una transacción.
4. **¿Quién se entera?** Tras el commit, el bus publica y SSE entrega a asesor/admin/app.

## Resiliencia

| Situación | Qué pasa |
|---|---|
| Cierra la pestaña a mitad | Cada paso ya está guardado; otro canal lo retoma |
| Webhook duplicado | `idempotencyKey` → `duplicate: true`, no avanza |
| Dos canales a la vez | `version` → uno gana, el otro 409 + `CONFLICT_DETECTED` |
| Se cae la red del tablero | SSE reconecta y reenvía desde `Last-Event-ID` |
| Reinicio del servidor | El estado está en Postgres, no en memoria |
| LLM caído | Reglas por palabras clave + menú |
