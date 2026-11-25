# Diagramas del proyecto conforme a los lineamientos

Estos diagramas responden directamente a la sección **“Diagramas y Arquitectura Técnica”** y a los requisitos de las Fases 1 y 2 de *ENH26-Estructura Entregable - SWI-SALUD DIGNA* (pp. 4–5). Describen la implementación del prototipo en este checkout; no representan como implementadas las integraciones reales que siguen pendientes.

## Correspondencia con lo solicitado

| Lineamiento | Diagrama |
|---|---|
| Conexión de canales simulados, motor de contexto y base de datos | 1. Arquitectura general |
| Resolución de identidad, persistencia del contexto y catálogo de eventos | 1 y 3 |
| Continuidad: iniciar en un canal y retomar en otro sin empezar de cero | 2. Secuencia omnicanal |
| Patient Journey por etapa, canal e historial, actualizado en tiempo real | 1, 2 y 4 |
| Vistas y permisos diferenciados para paciente, asesor y administrador | 5. Roles y visibilidad |
| Flujo de datos validado al cambiar de canal y su modelo de datos | 2 y 3 |

## 1. Arquitectura general: canales, motor de contexto y base de datos

```mermaid
flowchart LR
  subgraph CANALES["Canales simulados incluidos"]
    WEB["Web paciente<br/>/web"]
    WA["WhatsApp<br/>simulador / API simulator"]
    APP["App paciente<br/>/app · navegador o Capacitor"]
    CC["Call Center<br/>consola de asesor"]
    ADM["Administrador<br/>tablero Patient Journey"]
  end

  subgraph NEXT["SaludDigna · Next.js"]
    ROUTES["API Routes<br/>validación de entradas"]
    AUTH["Sesión, identidad<br/>y control por rol"]
    ENGINE["Motor de contexto<br/>createCase · resumeCase · advance"]
    BUS["Publicación de eventos<br/>después del commit"]
    SSE["SSE /api/events<br/>replay por seq"]
    AI["IA opcional<br/>intención y resumen"]
    ROUTES --> AUTH
    AUTH --> ENGINE
    ENGINE --> BUS
    BUS --> SSE
    ROUTES -. texto redactado .-> AI
  end

  subgraph DATA["PostgreSQL"]
    PATIENT["Patient"]
    IDENTITY["ChannelIdentity"]
    CASE["Case<br/>step + data JSON + version"]
    EVENT["Event<br/>bitácora append-only"]
  end

  WEB & WA & APP & CC & ADM --> ROUTES
  ENGINE <--> PATIENT
  ENGINE <--> IDENTITY
  ENGINE <--> CASE
  ENGINE --> EVENT
  SSE --> WEB
  SSE --> APP
  SSE --> CC
  SSE --> ADM
```

**Lectura del diagrama**

- Los canales comparten una sola API y el mismo motor; las pantallas no mantienen una copia independiente del trámite.
- `Case` almacena el estado vigente (`step`, `data`) y el canal de la última actividad. `version` permite detectar escrituras concurrentes.
- Cada transición escribe el cambio y sus eventos en PostgreSQL dentro de una transacción. El evento se publica al bus solo después del commit.
- SSE distribuye actividad a las vistas autorizadas. `seq` permite reanudar la lectura después de una desconexión.
- La IA es opcional; no es fuente de verdad ni ejecuta transiciones del trámite.
- WhatsApp en este prototipo es un simulador. El webhook de Meta/Twilio no está incluido.
- WEB-CLINICA es un frontend separado y necesita un backend SWI compatible; no forma parte del flujo/API dibujado aquí.

## 2. Secuencia: un trámite que pasa por Web, WhatsApp, Call Center y App

```mermaid
sequenceDiagram
  autonumber
  actor P as Paciente
  participant W as Web /web
  participant API as API SaludDigna
  participant ID as Identidad y OTP
  participant DB as PostgreSQL
  participant WA as Simulador WhatsApp
  participant CC as Asesor Call Center
  participant SSE as Eventos / SSE
  participant ADM as Admin
  participant APP as App /app

  P->>W: Abre Web e ingresa teléfono
  W->>API: POST /api/auth/otp/request
  API->>ID: Crear challenge OTP
  ID->>DB: Guardar hash, vigencia e intentos
  API-->>W: demoCode (solo modo demostración)
  P->>W: Ingresa el código recibido
  W->>API: POST /api/auth/otp/verify
  API->>ID: Verificar código y ligar identidad
  ID->>DB: Patient + ChannelIdentity (WEB)
  API-->>W: Sesión de paciente

  W->>API: POST /api/cases
  API->>DB: Crear Case + CASE_CREATED
  P->>W: Elige estudio
  W->>API: Avance con expectedVersion
  API->>DB: Actualizar Case + STEP_COMPLETED
  DB-->>API: Commit
  API->>SSE: Publicar evento confirmado
  SSE-->>ADM: Actualizar etapa y recorrido
  W-->>P: Mostrar siguiente paso pendiente

  P->>WA: Envía “Hola”
  WA->>API: Mensaje del simulador
  API->>ID: Resolver número y pedir/verificar fecha de nacimiento
  ID->>DB: Validar Patient y ChannelIdentity (WHATSAPP)
  API->>DB: Buscar trámite abierto
  API->>DB: Registrar CASE_RESUMED (WEB → WHATSAPP)
  API-->>WA: Mostrar estudio, clínica y paso pendiente
  WA-->>P: Ofrecer horarios sin volver a pedir lo ya capturado
  P->>WA: Elige horario
  WA->>API: advance(expectedVersion, wa:messageId)
  API->>DB: Actualizar Case + evento en una transacción
  DB-->>API: Commit
  API->>SSE: Publicar evento confirmado
  SSE-->>ADM: Actualizar Patient Journey
  SSE-->>W: Si sigue abierta, refrescar la vista Web

  P->>CC: Solicita ayuda por teléfono
  CC->>API: Login del personal y búsqueda del paciente
  API-->>CC: Coincidencias con datos enmascarados
  P-->>CC: Proporciona fecha de nacimiento y últimos 4 dígitos
  CC->>API: POST de verificación del asesor
  API->>ID: Validar los dos datos
  API->>DB: Guardar avance y eventos del asesor
  API-->>CC: Mostrar contexto autorizado
  CC->>API: Confirmar datos y cita
  API->>DB: Case = CITA_CONFIRMADA + APPOINTMENT_CONFIRMED
  DB-->>API: Commit
  API->>SSE: Publicar evento confirmado
  SSE-->>ADM: Mostrar cita confirmada y Call Center en el recorrido
  SSE-->>W: Actualizar la vista Web abierta

  P->>APP: Inicia sesión con OTP
  APP->>API: Consultar trámite, cita e historial
  API->>DB: Leer Case, Patient y Event
  API-->>APP: Cita, folio, clínica y preparación
  SSE-->>APP: Mantener la vista actualizada
```

**Validaciones que protegen la continuidad**

1. Web y App verifican el teléfono con OTP; WhatsApp simulado valida número y fecha de nacimiento; el asesor valida fecha de nacimiento y últimos cuatro dígitos.
2. `ChannelIdentity` relaciona el identificador de cada canal con el mismo `Patient`. Los casos anónimos, si existen, se ligan al verificarse.
3. Antes de avanzar, el motor valida transición y datos y compara `expectedVersion`. Una versión obsoleta produce conflicto `409`, no sobreescribe el avance del otro canal.
4. Los mensajes de WhatsApp usan su `messageId` como clave de idempotencia; un reintento no debe avanzar dos veces.
5. El tablero y las vistas autorizadas reciben eventos después de persistirse. Si SSE se reconecta, puede solicitar eventos posteriores al último `seq` recibido.

**Alcance de la demo:** el OTP se muestra como `demoCode`, no se envía por SMS. El remitente de WhatsApp proviene del simulador, no de una verificación de firma del proveedor.

## 3. Modelo de datos para identidad, contexto e historial

```mermaid
erDiagram
  Patient o|--o{ ChannelIdentity : "identidad vinculada"
  Patient o|--o{ Case : "trámites del paciente"
  ChannelIdentity o|--o{ Case : "trámite anónimo"
  Case o|--o{ Event : "historial del trámite"
  Patient o|--o{ Event : "recorrido del paciente"

  Patient {
    string id PK
    string nombre
    date fechaNac
    string telefono UK
    string email
  }
  ChannelIdentity {
    string id PK
    enum channel
    string externalId
    string patientId FK "nullable hasta verificar"
    datetime verifiedAt
    json convState
  }
  Case {
    string id PK
    enum step
    json data "foto actual del contexto"
    int version "control concurrente"
    enum lastChannel
    string patientId FK "nullable"
    string anonIdentityId FK "nullable"
  }
  Event {
    bigint seq PK
    string type
    enum channel
    json payload
    string caseId FK "nullable"
    string patientId FK "nullable"
    string actorId "id del personal; no es FK en el schema actual"
    string idempotencyKey UK
    datetime createdAt
  }
  Study {
    string id PK
    string nombre
    int precio
    string preparacion
  }
  Clinic {
    string id PK
    string nombre
    string ciudad
    string direccion
  }
  StaffUser {
    string id PK
    string email UK
    enum role
    string nombre
  }
  OtpChallenge {
    string id PK
    string telefono
    string codeHash
    datetime expiresAt
    int attempts
    datetime usedAt
  }
```

`Case.data` guarda la selección y los datos progresivos del trámite como JSON; el catálogo `Study`/`Clinic` vive en tablas del prototipo y sus selecciones se copian al contexto, sin FK entre esas tablas y `Case`. `Event` conserva la película ordenada del recorrido (`seq`), mientras `Case` mantiene la foto actual. `OtpChallenge` se asocia por teléfono, no por una relación FK a `Patient`. La relación `Event.actorId` con `StaffUser` es conceptual: el schema actual guarda ese identificador como texto, sin declarar una relación Prisma.

## 4. Estados del trámite y publicación al Patient Journey

```mermaid
stateDiagram-v2
  [*] --> INICIADO
  INICIADO --> ESTUDIO_ELEGIDO: elegir estudio
  ESTUDIO_ELEGIDO --> CLINICA_ELEGIDA: elegir clínica
  CLINICA_ELEGIDA --> HORARIO_ELEGIDO: elegir horario
  HORARIO_ELEGIDO --> DATOS_CONFIRMADOS: confirmar identidad/datos
  DATOS_CONFIRMADOS --> CITA_CONFIRMADA: confirmar cita
  INICIADO --> CANCELADO: cancelar
  ESTUDIO_ELEGIDO --> CANCELADO: cancelar
  CLINICA_ELEGIDA --> CANCELADO: cancelar
  HORARIO_ELEGIDO --> CANCELADO: cancelar
  DATOS_CONFIRMADOS --> CANCELADO: cancelar
  CITA_CONFIRMADA --> CANCELADO: cancelar
  CITA_CONFIRMADA --> [*]
  CANCELADO --> [*]
```

Cada avance cambia `Case.step`/`Case.data`, incrementa `Case.version` y agrega `STEP_COMPLETED`, `APPOINTMENT_CONFIRMED` o `CASE_CANCELLED` según corresponda. Si cambia el canal, se agrega `CASE_RESUMED`. El tablero deriva la etapa actual del caso y el recorrido cronológico de sus eventos; el estado no se reconstruye desde la interfaz del navegador.

## 5. Vistas y permisos por rol

```mermaid
flowchart TB
  subgraph PACIENTE["Paciente"]
    WEB["Web / App"]
    WA["WhatsApp simulado"]
    WEB --> OWN["Solo su trámite<br/>y sus eventos"]
    WA --> OWN
    OWN --> RETOMAR["Consultar y continuar<br/>el paso pendiente"]
  end

  subgraph PERSONAL["Personal autenticado"]
    STAFF["Login Asesor/Admin"]
    STAFF --> ROLE{"Rol"}
    ROLE -->|ASESOR| MASK["Búsqueda enmascarada"]
    MASK --> VERIFY["Validar fecha de nacimiento<br/>+ últimos 4 del teléfono"]
    VERIFY -->|válido| EXP["Expediente, resumen<br/>y trámites autorizados"]
    VERIFY -->|no válido| DENY["Sin acceso al detalle"]
    ROLE -->|ADMIN| MONITOR["Monitorear Patient Journey<br/>y eventos de todos los canales"]
  end

  AUDIT["Eventos de actividad<br/>y trazabilidad"]
  EXP --> AUDIT
  MONITOR --> AUDIT
```

Las cookies de Web, App y personal son independientes (`sd_web`, `sd_app`, `sd_staff`). El rol `ADMIN` puede monitorear sin la validación del asesor; el rol `ASESOR` debe validar al paciente antes de acceder al detalle. El código de permisos está en `lib/auth/session.ts`.

## Referencias de implementación

- Arquitectura y decisiones: [arquitectura.md](arquitectura.md)
- Secuencia general del caso de Ana: [secuencia.md](secuencia.md)
- Modelo y máquina de estados: [modelo-datos.md](modelo-datos.md)
- Tipos de eventos: [eventos.md](eventos.md)
- Integraciones de producción pendientes: [integracion.md](integracion.md)
- Instalación y canales disponibles: [instalacion-canales.md](instalacion-canales.md)
