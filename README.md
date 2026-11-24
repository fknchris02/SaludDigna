# Omnicanal Salud Digna — "Un paciente, una sola conversación"

Prototipo para el reto Salud Digna x TecNM HackaTec: un paciente inicia un trámite en un canal (Web) y lo continúa en otros (WhatsApp, Call Center, App) sin repetir datos ni perder su avance.

- Arquitectura: [docs/arquitectura.md](docs/arquitectura.md)
- Flujo de datos / secuencia: [docs/secuencia.md](docs/secuencia.md)
- Modelo de datos y máquina de estados: [docs/modelo-datos.md](docs/modelo-datos.md)
- Catálogo de eventos: [docs/eventos.md](docs/eventos.md)

## Requisitos

- Node.js 20+
- Docker (para PostgreSQL), o un PostgreSQL 15+ propio

## Instalación

```bash
cp .env.example .env          # ajusta OTP_SECRET
docker compose up -d          # PostgreSQL en :5432 (crea también omnicanal_test)
npm install                   # también genera el cliente de Prisma
npm run db:migrate            # aplica migraciones
npm run db:seed               # catálogo, Ana, asesor, admin y casos de ejemplo
npm run dev                   # http://localhost:3000
```

Sin Docker: crea las bases `omnicanal` y `omnicanal_test` en tu PostgreSQL y ajusta `DATABASE_URL` / `TEST_DATABASE_URL` en `.env`.

## Credenciales de prueba

| Rol | Acceso |
|---|---|
| Paciente (Ana López) | Tel. `667 000 0001`, nacimiento `1992-04-15`; el OTP se muestra en pantalla (demo sin SMS) |
| Asesor | `asesor@demo.mx` / `asesor123` |
| Administrador | `admin@demo.mx` / `admin123` |

Datos, precios y direcciones del seed son ficticios.

## Pruebas

```bash
npm test
```

Corre contra la base `TEST_DATABASE_URL` (se sincroniza sola con `prisma db push`). Cubren: transiciones válidas/inválidas, flujo completo, corrección de pasos, idempotencia (también en paralelo), bloqueo optimista entre canales, `CASE_RESUMED` al cambiar de canal, ligado de identidad anónima → paciente, OTP (intentos, expiración, un solo uso) y verificación por fecha de nacimiento.

## Estructura

```
app/api/cases            POST crear trámite · GET trámite abierto del paciente
app/api/cases/[id]       GET contexto + línea de tiempo · POST avanzar (409 si hay conflicto)
app/api/events           SSE en tiempo real (filtros caseId/patientId, replay con Last-Event-ID)
lib/engine/case.ts       máquina de estados; advance() es la ÚNICA forma de cambiar un trámite
lib/engine/identity.ts   normalización de teléfono, identidades por canal, OTP, ligado
lib/engine/events.ts     catálogo de eventos, bitácora append-only y bus
prisma/                  esquema, migraciones y seed
docs/                    diagramas (Mermaid)
```

## API rápida

```bash
# crear trámite
curl -XPOST localhost:3000/api/cases -H 'content-type: application/json' \
  -d '{"channel":"WEB","patientId":"<id>"}'

# avanzar (expectedVersion = versión que el canal leyó)
curl -XPOST localhost:3000/api/cases/<caseId> -H 'content-type: application/json' \
  -d '{"to":"ESTUDIO_ELEGIDO","data":{"studyId":"us-abdominal"},"channel":"WEB","expectedVersion":1}'

# escuchar eventos en vivo
curl -N "localhost:3000/api/events?patientId=<id>"
```

## Estado

Hecho: motor de contexto, identidad/OTP, eventos + SSE, API de trámites, seed, pruebas, diagramas.

Pendiente: sesiones y RBAC (las API aún no exigen sesión; ver comentarios `shortcut:`), UI de Web / WhatsApp / Asesor / App / Admin, handler de WhatsApp + Twilio, IA (intención y resumen), guion de demo.
