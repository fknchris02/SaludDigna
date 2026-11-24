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
| Paciente (Ana López) | Tel. `667 000 0001`, nacimiento `1992-04-15` (en WhatsApp: `15/04/1992`); el OTP se regresa como `demoCode` (demo sin SMS) |
| Asesor | `asesor@demo.mx` / `asesor123` |
| Administrador | `admin@demo.mx` / `admin123` |

Datos, precios y direcciones del seed son ficticios.

## Simulador de WhatsApp

Abre `http://localhost:3000/whatsapp`, deja el número de Ana y escribe **Hola**. El bot pide la fecha de nacimiento, reconoce el trámite pendiente (si lo empezó en otro canal) y continúa donde se quedó. Con un número que no existe, registra al paciente (nombre + fecha) y empieza desde cero. Palabras clave en cualquier momento: *cancelar*, *asesor*, *¿necesito ayuno?*, *¿cuánto cuesta?*.

El simulador y el futuro webhook de Twilio usan el mismo manejador: `lib/channels/whatsapp.ts`.

## Pruebas

```bash
npm test
```

Corre contra la base `TEST_DATABASE_URL` (se sincroniza sola con `prisma db push`). Cubren: transiciones válidas/inválidas, flujo completo, corrección de pasos, idempotencia (también en paralelo), bloqueo optimista entre canales, `CASE_RESUMED` al cambiar de canal, ligado de identidad anónima → paciente, OTP (intentos, expiración, un solo uso), verificación por fecha de nacimiento, permisos por rol y el recorrido de WhatsApp (retomar trámite de la web, mensaje duplicado, opción vieja tras cambio en otro canal, cancelación y registro de número nuevo).

## Estructura

```
app/api/auth/otp/request     POST pedir OTP (Web/App)
app/api/auth/otp/verify      POST verificar OTP → liga identidad y deja la sesión identificada
app/api/auth/staff/login     POST login de asesor/admin
app/api/auth/logout          POST cerrar sesión de un canal
app/api/auth/me              GET quién soy + trámite pendiente
app/api/cases                POST crear trámite · GET trámite abierto
app/api/cases/[id]           GET contexto + línea de tiempo (auditado si es personal) · POST avanzar (409 si hay conflicto)
app/api/events               SSE en tiempo real (filtrado por permisos, replay con Last-Event-ID)
app/api/whatsapp/simulator   POST mensaje entrante · GET historial de un número
app/whatsapp                 simulador visual de WhatsApp
lib/auth/session.ts          sesiones JWT por canal (cookies sd_web / sd_app / sd_staff) y permisos
lib/channels/whatsapp.ts     manejador único de WhatsApp (identidad, retomar, opciones, intenciones)
lib/ai/intent.ts             clasificación de intención (reglas; aquí se conectará el LLM)
lib/engine/                  motor: trámites (advance), identidad/OTP, eventos y bus
prisma/                      esquema, migraciones y seed
docs/                        diagramas (Mermaid)
```

## Sesiones y canal

Cada canal tiene su cookie (`sd_web`, `sd_app`, `sd_staff`) para que en la demo convivan en el mismo navegador. El cliente indica el canal con el header `x-sd-channel: WEB | APP | CALL_CENTER` (o `?as=` en SSE); eso solo elige qué cookie leer.

| Quién | Puede |
|---|---|
| Visitante web | crear y avanzar su trámite anónimo |
| Paciente (Web/App) | solo sus trámites y sus eventos |
| Asesor | cualquier trámite (cada consulta queda auditada); eventos de un caso/paciente |
| Admin | todo, incluido el flujo completo de eventos |

## API rápida

```bash
# visitante web: crear y avanzar trámite (guarda la cookie)
curl -c c.txt -b c.txt -XPOST localhost:3000/api/cases -H 'x-sd-channel: WEB' -H 'content-type: application/json' -d '{}'
curl -b c.txt -XPOST localhost:3000/api/cases/<caseId> -H 'x-sd-channel: WEB' -H 'content-type: application/json' \
  -d '{"to":"ESTUDIO_ELEGIDO","data":{"studyId":"us-abdominal"},"expectedVersion":1}'

# WhatsApp simulado
curl -XPOST localhost:3000/api/whatsapp/simulator -H 'content-type: application/json' -d '{"from":"6670000001","text":"Hola"}'

# admin escuchando todo en vivo
curl -c a.txt -XPOST localhost:3000/api/auth/staff/login -H 'content-type: application/json' -d '{"email":"admin@demo.mx","password":"admin123"}'
curl -N -b a.txt "localhost:3000/api/events?as=STAFF"
```

## Estado

Hecho: motor de contexto, identidad/OTP, eventos + SSE, API de trámites, sesiones y permisos por rol, manejador de WhatsApp + simulador, seed, pruebas, diagramas.

Pendiente: UI de Web / Asesor / App / Admin, webhook de Twilio, IA con LLM (intención y resumen), guion de demo. Atajos conocidos: buscar `shortcut:` en el código.
