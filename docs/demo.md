# Guion de la demo — "Un paciente, una sola conversación"

Duración objetivo: **8 minutos** + preguntas. Recorrido principal: **Web → WhatsApp → Call Center → App**, como el ejemplo de Ana del reto, más 3 pruebas de resiliencia en vivo.

---

## 1. Preparación (15 min antes)

```bash
docker compose up -d
npm run db:seed        # deja la base limpia: Ana sin trámites + 5 recorridos de ejemplo
npm run dev            # http://localhost:3000
```

**Ventanas** (recomendado: dos pantallas o pantalla dividida):

| # | Ventana | URL | Sesión |
|---|---|---|---|
| A | Navegador normal | `/web` | (sin sesión) |
| B | Navegador normal, otra pestaña | `/whatsapp` | (el simulador no usa sesión) |
| C | Navegador normal, otra pestaña | `/asesor/login` | `asesor@demo.mx` / `asesor123` |
| D | Navegador normal, otra pestaña | `/app` | se entra en vivo con el teléfono de Ana |
| E | **Ventana de incógnito** (o otro navegador) | `/asesor/login` → `/admin` | `admin@demo.mx` / `admin123` |

> ⚠️ El tablero (E) va en **incógnito**: asesor y admin comparten la cookie del personal, así que en la misma ventana un login cierra el otro.

**Checklist:**
- [ ] El tablero (E) dice **● En vivo** y muestra 5 recorridos: Sofía y Lucía con cita confirmada y el resto **Pausado** (más de 10 min sin actividad desde el seed).
- [ ] En el simulador (B) el número es `667 000 0001` (Ana) y la conversación está vacía.
- [ ] IA: con `ANTHROPIC_API_KEY` en `.env`, el resumen del asesor mostrará la etiqueta **IA**. Sin llave todo funciona igual con reglas: no cambies nada del guion.
- [ ] Ten abierta una terminal en la carpeta del proyecto para `npm run demo:resiliencia`.
- [ ] Video de respaldo grabado del recorrido completo (por si falla el proyector o la red).

**Datos de Ana:** teléfono `667 000 0001`, nacimiento `15/04/1992`, últimos 4 dígitos `0001`.

---

## 2. Guion

### 0:00 — El problema (30 s)
> "Hoy, si Ana cotiza en la web y luego escribe por WhatsApp, empieza de cero. Nuestro sistema resuelve los 4 pilares del reto: **identidad** (sabemos que es Ana en cualquier canal), **contexto y estado** (su trámite vive en un solo lugar), **trazabilidad** (cada paso queda registrado con canal, hora y quién) y **seguridad** (verificación por canal, datos ocultos hasta validar, auditoría)."

Muestra el tablero (E): *"Así se ven los pacientes moviéndose entre canales en tiempo real."*

### 0:45 — Paso 1: Web (1 min) · ventana A
1. "Empieza con tu teléfono": `667 000 0001` → **Enviar código** → copia el código de demo → **Verificar**.
2. Elige **Ultrasonido abdominal** → **Clínica Culiacán Centro**. Cada paso aparece al instante en el tablero (E).
3. Ya pide horario. **Cierra la pestaña.**
> "Ana tuvo que cerrar la computadora. Su avance no se perdió: está en el servidor, no en el navegador."

Señala el tablero (E): Ana aparece con **Web** y etapa **Clínica**.

### 1:45 — Paso 2: WhatsApp (1.5 min) · ventana B
1. Escribe `Hola` → el bot pide fecha de nacimiento (no revela nada antes de verificar).
2. Escribe `15/04/1992` → **"Ana, tienes un trámite pendiente que iniciaste en el sitio web: Ultrasonido abdominal · Clínica Culiacán Centro. Sigamos donde te quedaste"** y ofrece horarios.
3. Elige horario:
   - **Con IA:** escribe con tus palabras uno de los horarios ofrecidos, p. ej. `el segundo día a las 10` (lenguaje natural).
   - **Sin IA:** toca un botón de horario.
4. Escribe `¿necesito ayuno?` → responde con la preparación de *su* estudio y vuelve a la pregunta pendiente.
5. Escribe `quiero hablar con un asesor`.

Señala el tablero (E): **Web → WhatsApp**, celda Web→WhatsApp de la matriz sube, actividad en vivo.

### 3:15 — Paso 3: Call Center (1.5 min) · ventana C
1. Busca `0001` → aparece **"Ana L. · +52\*\*\*\*\*\*0001"** (datos ocultos).
2. **Validar identidad**: fecha `1992-04-15`, últimos 4 dígitos `0001`.
3. Lee el **resumen** en voz alta: recorrido Web → WhatsApp, qué falta, que preguntó por el ayuno y pidió asesor. Muestra la **línea de tiempo** con los mensajes de WhatsApp.
> "El asesor no le pide nada a Ana: ya sabe estudio, clínica, horario y su duda."
4. **Datos confirmados con el paciente** → **Confirmar cita** → aparece el folio.

Señala el tablero (E): en **Auditoría** aparece *Luis Asesor (asesor) · Expediente consultado · Ana López*; el recorrido de Ana queda **Web → WhatsApp → Call Center · ✓ Cita confirmada**.

### 4:45 — Paso 4: App (45 s) · ventana D
1. `667 000 0001` → código → **Verificar**.
2. **Tu próxima cita**: fecha, clínica con dirección, **folio** y preparación.
> "Cuatro canales, una sola conversación, cero datos repetidos."

### 5:30 — Resiliencia en vivo (2 min)
Elige 2 o 3 según el tiempo:

1. **Edición simultánea y mensaje duplicado** — en la terminal:
   ```bash
   npm run demo:resiliencia
   ```
   Dos canales escriben el mismo trámite a la vez: uno se guarda, el otro recibe **409** y queda registrado (KPI **Conflictos detectados** sube en el tablero). Luego WhatsApp reenvía el mismo mensaje: se procesa **una sola vez**.
2. **Proceso pendiente recuperado** — en el simulador cambia el número a `667 000 0006` (**Miguel**, *Pausado* en el tablero desde la web) → `Hola` → `27/03/1969` → el bot retoma su ultrasonido donde lo dejó; en el tablero pasa a **Activo**.
3. **Caída del servidor** — en la terminal de `npm run dev`, `Ctrl+C`: el tablero muestra **Reconectando…**. Vuelve a correr `npm run dev`: regresa solo a **● En vivo** y nada se perdió (todo está en PostgreSQL; el navegador pide lo que se perdió con `Last-Event-ID`).
4. **Continuar en otro canal desde la app** — en la app entra con `667 000 0002` (**Carlos**, dejó su trámite en WhatsApp): "Te falta: elegir horario. Lo dejaste en WhatsApp" → **Continuar aquí** → termina en la app.
5. **IA apagada** — reinicia con `AI_DISABLED=1 npm run dev`: WhatsApp sigue funcionando con botones y el resumen pasa a "automático".

### 7:30 — Cierre (30 s)
> "Arquitectura: un motor de contexto con una sola función que cambia el estado (`advance`), una bitácora de eventos que nunca se borra y SSE para tiempo real. 37 pruebas automáticas cubren identidad, conflictos, idempotencia y el recorrido de WhatsApp. Todo está en el repositorio con diagramas."

---

## 3. Plan B

| Si pasa… | Haz… |
|---|---|
| Algo quedó en un estado raro | `npm run db:seed` (2 s) y repite desde el paso que toque |
| No hay internet | Todo corre local; la IA cae sola a reglas en ≤ 6 s |
| El LLM tarda o falla | Nada que hacer: el bot responde por reglas y la consola muestra el resumen automático |
| Un login cierra otro | El admin va en incógnito (ver Preparación) |
| El asesor ve "Valida la identidad" de nuevo | La validación dura 2 h por asesor; vuelve a validar con `1992-04-15` + `0001` |
| Falla el proyector o la laptop | Video de respaldo |

---

## 4. Preguntas probables del jurado

**¿Cómo sabe que es la misma persona en cada canal?** El teléfono verificado es la llave maestra. Web y App verifican con código (OTP); en WhatsApp el número ya lo garantiza el proveedor y pedimos fecha de nacimiento; en Call Center el asesor valida 2 datos. Cada canal tiene su identidad (`ChannelIdentity`) que se liga al paciente; lo que el visitante hizo como anónimo pasa al paciente al verificarse.

**¿Qué pasa si dos canales cambian el trámite al mismo tiempo?** Bloqueo optimista con `version`: el segundo recibe 409 y recarga; nunca se pisa información y el conflicto queda en la bitácora.

**¿Y si WhatsApp reenvía un mensaje?** Idempotencia por id del mensaje: se procesa una sola vez.

**¿Cómo protegen los datos?** Sesiones firmadas por canal (cookies httpOnly), permisos por rol, datos ocultos para el asesor hasta validar, auditoría de cada consulta, OTP con hash y límite de intentos, y al LLM no se le manda nombre, teléfono ni fecha de nacimiento. En producción: TLS, cifrado en reposo y aviso de privacidad conforme a la LFPDPPP (datos de salud son sensibles).

**¿Escala?** Es un monolito modular orientado a eventos: el motor (`lib/engine`) se puede extraer como servicio, el bus en memoria se reemplaza por Postgres LISTEN/NOTIFY, Redis o Kafka, y los agregados del tablero por vistas materializadas. Los atajos conocidos están marcados con `shortcut:` en el código.

**¿Por qué SSE y no WebSockets?** El tiempo real va del servidor al navegador; las acciones ya son peticiones HTTP. SSE reconecta solo y, con `Last-Event-ID`, reenvía lo que se perdió durante un corte, que es justo la resiliencia que pide el reto.

**¿Qué hace la IA y qué pasa si falla?** Entiende texto libre en WhatsApp (intención y elección de opciones) y resume el caso para el asesor. Está acotada: el estado lo cambia siempre el motor determinista, no el LLM, y ante cualquier falla se usan reglas.
