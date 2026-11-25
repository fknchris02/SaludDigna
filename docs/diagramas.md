# Mapa de diagramas

Este índice reúne los diagramas del prototipo y separa el sistema que existe en el workspace de las integraciones futuras. Los diagramas Mermaid se pueden leer en GitHub y en editores compatibles con Mermaid.

## Diagrama de despliegue actual

```mermaid
flowchart TB
  subgraph Workspace["Workspace local"]
    subgraph SD["SaludDigna · Next.js :3000"]
      PAGES["/web · /whatsapp<br/>/app · /asesor · /admin"]
      API["API Routes"]
      CORE["Identidad · motor de trámites<br/>eventos · IA opcional"]
      SSE["SSE /api/events"]
      PAGES --> API --> CORE
      CORE --> SSE
    end
    DB[("PostgreSQL :5432")]
    CLINIC["WEB-CLINICA · Next.js :3001"]
    SD --> DB
  end

  BROWSER["Navegador"]
  ANDROID["Android / Capacitor"]
  SWI["API SWI externa<br/>necesaria para Clínica"]

  BROWSER --> PAGES
  ANDROID -->|"carga /app y llama al backend"| SD
  SSE -->|"Web, App, Call Center y Admin"| BROWSER
  CLINIC -->|"x-api-key + canal CLINICA"| SWI
```

**Límite importante:** WEB-CLINICA espera rutas de SWI que no están implementadas por la API de SaludDigna de este checkout. El diagrama muestra la dependencia requerida; no afirma que la integración entre ambas apps esté lista.

## Flujo compartido de los canales de paciente

```mermaid
flowchart LR
  WEB["Web /web"]
  WA["WhatsApp<br/>simulador"]
  APP["App /app<br/>web o Android"]
  CC["Asesor /asesor"]
  ADMIN["Admin /admin"]

  API["API de SaludDigna"]
  ID["Identidad del canal<br/>+ verificación"]
  CASE["Case actual<br/>+ versión"]
  EVENT["Event append-only"]
  DB[("PostgreSQL")]
  SSE["SSE"]

  WEB & WA & APP & CC --> API
  API --> ID --> CASE
  CASE --> DB
  CASE --> EVENT --> DB
  EVENT --> SSE
  SSE --> WEB & APP & CC & ADMIN
```

El recorrido detallado de una persona es [secuencia.md](secuencia.md); el diseño futuro para proveedores reales está en [integracion.md](integracion.md).
La versión que vincula cada requisito del PDF con un diagrama específico está en [diagramas-lineamientos.md](diagramas-lineamientos.md).

## Recorrido de una petición con escritura y actualización en vivo

```mermaid
sequenceDiagram
  autonumber
  participant C as Canal (Web/App/WhatsApp/Asesor)
  participant API as API Route
  participant Auth as Sesión y permisos
  participant Engine as Motor de contexto
  participant DB as PostgreSQL
  participant Bus as Bus de eventos
  participant SSE as /api/events
  participant V as Otras vistas conectadas

  C->>API: petición con canal y datos
  API->>Auth: resolver sesión e identidad
  Auth-->>API: actor autorizado
  API->>Engine: crear / avanzar trámite
  Engine->>DB: transacción Case + Event
  DB-->>Engine: commit
  Engine->>Bus: publicar evento confirmado
  Bus->>SSE: evento con seq
  SSE-->>V: actualización y replay si reconecta
  API-->>C: resultado o conflicto de versión
```

El catálogo de tipos de eventos y su significado está en [eventos.md](eventos.md). Los datos persistidos y la máquina de estados están en [modelo-datos.md](modelo-datos.md).

## Orden de instalación y dependencias

```mermaid
flowchart TD
  NODE["Node.js 20+"] --> NPM["npm install en SaludDigna"]
  DOCKER["Docker Compose o PostgreSQL 15+"] --> PG["PostgreSQL :5432"]
  ENV["Copiar .env.example a .env<br/>configurar URLs y secretos"] --> MIGRATE["npm run db:migrate"]
  NPM --> MIGRATE
  PG --> MIGRATE
  MIGRATE --> SEED["npm run db:seed"]
  SEED --> SERVER["npm run dev :3000"]
  SERVER --> CHANNELS["Web · WhatsApp simulado<br/>App web · Call Center · Admin"]
  ANDROID["Android Studio + JDK 21"] --> CAP["Capacitor apunta a /app"]
  SERVER --> CAP
  CLINIC["npm install en WEB-CLINICA"] --> CHECK["npm run check:swi"]
  SWI["Backend SWI compatible + llave"] --> CHECK
  CHECK --> CLINIC_SERVER["npm run dev :3001"]
```

La secuencia de instalación completa con comandos por sistema operativo está en [instalacion-canales.md](instalacion-canales.md).

## Índice de diagramas por tema

| Tema | Archivo | Qué representa |
|---|---|---|
| Componentes y arquitectura lógica | [arquitectura.md](arquitectura.md) | Canales, Next.js, motor, persistencia, SSE, identidad y escalamiento |
| Secuencia entre canales | [secuencia.md](secuencia.md) | Web → WhatsApp → Call Center → App, y validación/resiliencia |
| Modelo relacional | [modelo-datos.md](modelo-datos.md) | Patient, ChannelIdentity, Case, Event, StaffUser y OTP |
| Estados del trámite | [modelo-datos.md](modelo-datos.md) | Transiciones, correcciones y cancelación |
| Integración futura | [integracion.md](integracion.md) | Adaptadores de WhatsApp, Web/App, Call Center, Clínica y sistemas fuente |
| Diagramas según lineamientos | [diagramas-lineamientos.md](diagramas-lineamientos.md) | Arquitectura, secuencia, modelo, Journey y roles alineados con el entregable |
| Preparación e instalación | [instalacion-canales.md](instalacion-canales.md) | Topología actual, dependencias, canales y pasos de arranque |
| Ejecución Android | [android.md](android.md) | Backend, emulador, teléfono físico y URL de despliegue |
