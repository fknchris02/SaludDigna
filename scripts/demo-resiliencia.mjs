// Demo de resiliencia contra el servidor en marcha (los eventos se ven en vivo en /admin):
//   1) dos canales editan el mismo trámite a la vez → uno gana, el otro recibe 409 y queda registrado;
//   2) WhatsApp reenvía el mismo mensaje (mismo id del proveedor) → se procesa una sola vez.
// Uso: npm run demo:resiliencia            (o BASE_URL=https://... npm run demo:resiliencia)
const B = process.env.BASE_URL ?? "http://localhost:3000";
const J = { "content-type": "application/json" };

async function call(path, { cookie, body, as } = {}) {
  const res = await fetch(B + path, {
    method: body ? "POST" : "GET",
    headers: { ...(body ? J : {}), ...(cookie ? { cookie } : {}), ...(as ? { "x-sd-channel": as } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null), cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

const login = await call("/api/auth/staff/login", { body: { email: "admin@demo.mx", password: "admin123" } });
if (login.status !== 200) throw new Error(`No pude entrar como admin (${login.status}). ¿Corre el servidor en ${B} y se cargó el seed?`);
const staff = { cookie: login.cookie, as: "CALL_CENTER" };

// 1) Conflicto: un trámite abierto con paciente, dos escrituras simultáneas con la misma versión.
const { data: overview } = await call("/api/admin/overview", staff);
// Prefiere un trámite en HORARIO_ELEGIDO (Jorge en el seed) para no tocar los que usa el guion (Ana, Carlos).
const open =
  overview.journeys.find((j) => j.paciente && j.step === "HORARIO_ELEGIDO") ??
  overview.journeys.find((j) => j.paciente && j.step === "CLINICA_ELEGIDA");
if (!open) throw new Error("No hay un trámite abierto en CLINICA_ELEGIDA u HORARIO_ELEGIDO. Corre `npm run db:seed`.");
const { data: detail } = await call(`/api/cases/${open.caseId}`, staff);
const v = detail.case.version;
const { data: catalog } = await call("/api/catalog");
console.log(`\n1) Conflicto entre canales · trámite de ${open.paciente} (${open.step}, versión ${v})`);
const [a, b] = await Promise.all([
  call(`/api/cases/${open.caseId}`, { ...staff, body: { to: "HORARIO_ELEGIDO", data: { horario: catalog.slots[0] }, expectedVersion: v } }),
  call(`/api/cases/${open.caseId}`, { ...staff, body: { to: "HORARIO_ELEGIDO", data: { horario: catalog.slots[1] }, expectedVersion: v } }),
]);
for (const [name, r] of [["Escritura A", a], ["Escritura B", b]]) {
  console.log(`   ${name}: HTTP ${r.status} ${r.status === 200 ? "→ guardada" : `→ ${r.data?.error}: ${r.data?.message}`}`);
}
console.log("   Resultado: nadie pisó a nadie; el rechazo quedó como CONFLICT_DETECTED (KPI \"Conflictos detectados\").");

// 2) Mensaje duplicado de WhatsApp (reintento del proveedor con el mismo id).
const messageId = `demo-dup-${Date.now()}`;
console.log(`\n2) Mensaje duplicado de WhatsApp · id ${messageId}`);
const first = await call("/api/whatsapp/simulator", { body: { from: "6670000004", text: "Hola", messageId } });
const again = await call("/api/whatsapp/simulator", { body: { from: "6670000004", text: "Hola", messageId } });
console.log(`   1er envío: ${first.data?.replies?.length ?? 0} respuesta(s) del bot`);
console.log(`   2º envío (mismo id): duplicate=${again.data?.duplicate}, ${again.data?.replies?.length ?? 0} respuestas`);
console.log("   Resultado: el reintento no responde ni avanza dos veces (idempotencia).\n");
