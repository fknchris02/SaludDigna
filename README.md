# Omnicanal Salud Digna — "Un paciente, una sola conversación"

Prototipo para el reto Salud Digna x TecNM HackaTec: un paciente inicia un trámite en un canal (Web) y lo continúa en otros (WhatsApp, Call Center, App) sin repetir datos ni perder su avance.

- Arquitectura: [docs/arquitectura.md](docs/arquitectura.md)
- Flujo de datos / secuencia: [docs/secuencia.md](docs/secuencia.md)
- Modelo de datos y máquina de estados: [docs/modelo-datos.md](docs/modelo-datos.md)
- Catálogo de eventos: [docs/eventos.md](docs/eventos.md)
- Integración con canales reales: [docs/integracion.md](docs/integracion.md)

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

## Demo en 5 pasos

Guion completo, preparación, plan B y preguntas del jurado: **[docs/demo.md](docs/demo.md)**.

1. `npm run db:seed && npm run dev`; abre `/admin` en **incógnito** (`admin@demo.mx` / `admin123`).
2. `/web`: Ultrasonido abdominal → Clínica Culiacán Centro → teléfono `667 000 0001` + código en pantalla → cierra la pestaña.
3. `/whatsapp`: `Hola` → `15/04/1992` → el bot retoma el trámite de la web; elige horario, pregunta `¿necesito ayuno?`, pide `asesor`.
4. `/asesor` (`asesor@demo.mx` / `asesor123`): busca `0001`, valida con `1992-04-15` + `0001`, revisa el resumen y confirma la cita.
5. `/app`: entra con `667 000 0001` y ve la cita con su folio. Resiliencia: `npm run demo:resiliencia` (conflicto entre canales y mensaje duplicado).

## Credenciales de prueba

| Rol | Acceso |
|---|---|
| Paciente (Ana López) | Tel. `667 000 0001`, nacimiento `1992-04-15` (en WhatsApp: `15/04/1992`); el OTP se regresa como `demoCode` (demo sin SMS) |
| Asesor | `asesor@demo.mx` / `asesor123` |
| Administrador | `admin@demo.mx` / `admin123` |

Datos, precios y direcciones del seed son ficticios.

## Sitio web del paciente

Abre `http://localhost:3000/web`. Se puede cotizar sin cuenta: estudio → clínica → **guardar avance** (teléfono + código; el código de demo aparece en pantalla) → horario → confirmar datos → confirmar cita. Si el teléfono es nuevo, pide nombre y fecha de nacimiento sin gastar el código.

La pestaña escucha en vivo: si el paciente sigue en WhatsApp o un asesor confirma la cita, la web se actualiza sola y avisa desde qué canal continuó.

## App del paciente

Abre `http://localhost:3000/app` (marco de teléfono en escritorio; pantalla completa en celular) e inicia sesión con tu teléfono y el código de demo. Muestra la **próxima cita confirmada** (folio, clínica, dirección y preparación), el **trámite en curso** con lo que falta y en qué canal se dejó, y el historial. "Continuar aquí" retoma el trámite dentro de la app con el mismo flujo de la web (`app/_components/BookingFlow.tsx`). Se actualiza en vivo con lo que pase en otros canales.

### Ejecutar en Android Studio

La app Android usa Capacitor como contenedor de la misma interfaz y requiere que el backend Next.js esté accesible. Para un emulador Android, ejecuta `npm run dev:mobile` y luego `npm run cap:open`; compila y ejecuta el módulo `app` desde Android Studio. La configuración predeterminada apunta a `http://10.0.2.2:3000/app` (el localhost del emulador). Para un dispositivo físico, configura `CAPACITOR_SERVER_URL` con la IP LAN de tu PC antes de `npm run cap:sync`. Instrucciones completas: [docs/android.md](docs/android.md).

## Simulador de WhatsApp

Abre `http://localhost:3000/whatsapp`, deja el número de Ana y escribe **Hola**. El bot pide la fecha de nacimiento, reconoce el trámite pendiente (si lo empezó en otro canal) y continúa donde se quedó. Con un número que no existe, registra al paciente (nombre + fecha) y empieza desde cero. Palabras clave en cualquier momento: *cancelar*, *asesor*, *¿necesito ayuno?*, *¿cuánto cuesta?*.

El simulador y el futuro webhook de Twilio usan el mismo manejador: `lib/channels/whatsapp.ts`.

## Consola del asesor (Call Center)

Abre `http://localhost:3000/asesor` (entra con `asesor@demo.mx` / `asesor123`).

1. Busca al paciente por teléfono (4+ dígitos) o nombre (3+ letras): los datos salen **ocultos**.
2. Valida su identidad con 2 datos que te dicta: fecha de nacimiento y últimos 4 dígitos del teléfono (máx. 3 intentos; la validación dura 2 h y queda en la bitácora con el nombre del asesor).
3. Ves el expediente: resumen del contexto, trámite abierto con lo que falta, trámites anteriores y la **línea de tiempo en vivo** (lo que el paciente hace en WhatsApp aparece sin recargar).
4. Continúa el trámite (elegir/cambiar estudio, clínica u horario, confirmar datos, confirmar cita) o cancélalo. Si el paciente cambió algo en otro canal al mismo tiempo, la consola avisa y recarga la versión nueva.

El admin puede entrar a la misma consola sin validar (monitoreo).

## Tablero del administrador

Abre `http://localhost:3000/admin` (entra con `admin@demo.mx` / `admin123`). Todo se actualiza **en vivo** por SSE:

- **Indicadores:** trámites abiertos, pausados (sin actividad por 10 min: candidatos a recuperar), citas confirmadas y cambios de canal en 24 h, % de recorridos multicanal y conflictos detectados.
- **Trámites por etapa actual** y **matriz de cambios de canal** (de dónde a dónde continúan los pacientes).
- **Recorridos de pacientes:** etapa, canales recorridos en orden y estado; clic para ver la línea de tiempo del trámite.
- **Actividad en vivo** de todos los canales y **auditoría** de accesos del personal.

El seed incluye 5 pacientes con recorridos multicanal en distintos pasos y antigüedades para que el tablero no arranque vacío.

## Inteligencia artificial (Claude)

Opcional y con respaldo: con `ANTHROPIC_API_KEY` en `.env` se activa; sin ella (o con `AI_DISABLED=1`) todo funciona con reglas.

- **WhatsApp entiende lenguaje natural** (`lib/ai/intent.ts`): si las reglas no reconocen el mensaje, Claude clasifica la intención y mapea texto libre a la opción ofrecida ("el segundo día tempranito" → horario 4). Queda en la bitácora como `INTENT_CLASSIFIED` con `source: llm`.
- **Resumen para el asesor** (`lib/ai/summary.ts`): 3-5 líneas con qué quiere el paciente, por dónde pasó, qué falta, sus dudas y la siguiente acción. La consola muestra al instante el resumen por reglas y lo cambia por el de IA (etiqueta "IA") cuando llega; se cachea por último evento.
- **Privacidad:** al LLM no se mandan nombre, teléfono ni fecha de nacimiento; los números largos y correos en mensajes se reemplazan (`redact`).
- **Resiliencia:** salidas estructuradas (zod), timeout de 6 s sin reintentos, respaldo del servidor ante rechazos (`fallbacks: "default"`) y, ante cualquier falla, regreso a reglas.
- Modelo: `AI_MODEL` (por defecto `claude-opus-5-5`, esfuerzo bajo).

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
app/api/events               SSE en tiempo real (filtrado por permisos, replay con Last-Event-ID, since=latest)
app/api/whatsapp/simulator   POST mensaje entrante · GET historial de un número
app/api/staff/patients       GET búsqueda enmascarada (asesor)
app/api/staff/patients/[id]  GET expediente (requiere validación) · /verify POST validar 2 datos · /summary GET resumen IA
app/api/catalog              GET estudios, clínicas y horarios
app/api/patient/appointments GET trámite en curso, próximas citas e historial (paciente)
app/web                      sitio web del paciente (cotizar y agendar)
app/app                      app del paciente (citas y continuar trámites)
app/_components/             BookingFlow (agendado Web/App), OtpLogin, Timeline
app/whatsapp                 simulador visual de WhatsApp
app/api/admin/overview       GET datos del tablero (solo admin)
app/asesor                   consola del asesor (+ /asesor/login)
app/admin                    tablero del administrador
lib/auth/session.ts          sesiones JWT por canal (cookies sd_web / sd_app / sd_staff) y permisos
lib/channels/whatsapp.ts     manejador único de WhatsApp (identidad, retomar, opciones, intenciones)
lib/ai/                      IA: intención y opción por texto libre, resumen para el asesor (reglas como respaldo)
lib/engine/overview.ts       KPIs, etapas, transiciones y recorridos para el tablero
lib/format.ts, lib/labels.ts formato y etiquetas compartidos por servidor y navegador
lib/engine/                  motor: trámites (advance), identidad/OTP, eventos y bus
prisma/                      esquema, migraciones y seed
docs/                        diagramas (Mermaid) y guion de la demo
scripts/demo-resiliencia.mjs demo en vivo de conflicto entre canales e idempotencia
```

## Sesiones y canal

Cada canal tiene su cookie (`sd_web`, `sd_app`, `sd_staff`) para que en la demo convivan en el mismo navegador. El cliente indica el canal con el header `x-sd-channel: WEB | APP | CALL_CENTER` (o `?as=` en SSE); eso solo elige qué cookie leer.

| Quién | Puede |
|---|---|
| Visitante web | crear y avanzar su trámite anónimo |
| Paciente (Web/App) | solo sus trámites y sus eventos |
| Asesor | solo pacientes que validó en la llamada (2 datos, 2 h); cada consulta queda auditada |
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

Hecho: motor de contexto, identidad/OTP, eventos + SSE, API de trámites, sesiones y permisos por rol, manejador de WhatsApp + simulador, sitio web y app del paciente, consola del asesor, tablero del administrador, IA con Claude (con respaldo por reglas), seed, pruebas, diagramas.

Pendiente: webhook de Twilio (opcional). Atajos conocidos: buscar `shortcut:` en el código.
