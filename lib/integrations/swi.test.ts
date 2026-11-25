import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "@/test/db";
import { journeyFacts, summarizeJourney } from "@/lib/ai/summary";
import { captureProspectData, matchesQuote, verifyByStaff } from "@/lib/engine/identity";
import { hasCardNumber, ingestSwi, resumen, swiGrupo, validSwiKey } from "./swi";
import { getSwiJourney, getSwiOverview } from "./swi-overview";

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const tramite = (over: Record<string, unknown> = {}) => ({
  tipo: "TRAMITE",
  id: "t1",
  pacienteId: "p1",
  telefono: "6671112233",
  estudio: { clave: "RX-MANO", nombre: "Rayos X de mano", precio: 320, preparacion: "" },
  clinica: { nombre: "Clínica Navolato", ciudad: "Navolato", direccion: "Centro" },
  fechaCita: "2026-12-01T16:00:00Z",
  estado: "AGENDADO",
  canalOrigen: "WEB",
  canalActual: "WHATSAPP",
  ...over,
});
const paciente = (over: Record<string, unknown> = {}) => ({
  tipo: "PACIENTE",
  id: "p1",
  telefono: "6671112233",
  nombre: "",
  nombres: "Rosa",
  primerApellido: "Díaz",
  segundoApellido: "",
  fechaNacimiento: "1988-07-09",
  sexo: "M",
  curp: "",
  email: "rosa@demo.mx",
  ...over,
});

describe("integración SWI", () => {
  it("trámite antes que su paciente: crea a la paciente con el teléfono y la completa cuando llega", async () => {
    const r1 = await ingestSwi([tramite()]);
    expect(r1).toEqual({ ok: ["t1"], errores: [] });
    const placeholder = await db.patient.findUniqueOrThrow({ where: { telefono: "+526671112233" } });
    expect(placeholder.fechaNac).toBeNull();

    // Estudio y clínica que no estaban en el catálogo se crean con los datos de SWI (precio en pesos → centavos).
    expect(await db.study.findUnique({ where: { id: "RX-MANO" } })).toMatchObject({ nombre: "Rayos X de mano", precio: 32000 });
    expect(await db.clinic.findFirst({ where: { nombre: "Clínica Navolato" } })).not.toBeNull();

    await ingestSwi([paciente()]);
    const p = await db.patient.findUniqueOrThrow({ where: { id: placeholder.id } });
    expect(p).toMatchObject({ nombre: "Rosa Díaz", email: "rosa@demo.mx" });
    expect(p.fechaNac?.toISOString().slice(0, 10)).toBe("1988-07-09");
    expect((await db.swiPaciente.findUniqueOrThrow({ where: { id: "p1" } })).datos).toMatchObject({ nombres: "Rosa", sexo: "M" });
  });

  it("upsert por id: el mismo registro dos veces se actualiza, no se duplica", async () => {
    await ingestSwi([paciente(), tramite()]);
    const r = await ingestSwi([tramite({ estado: "CONFIRMADO", folioExterno: "SWI-9" }), tramite({ estado: "CONFIRMADO", folioExterno: "SWI-9" })]);
    expect(r.ok).toEqual(["t1", "t1"]);
    expect(await db.swiTramite.count()).toBe(1);
    expect(await db.swiTramite.findUniqueOrThrow({ where: { id: "t1" } })).toMatchObject({ estado: "CONFIRMADO", folioExterno: "SWI-9" });
    expect(await db.patient.count()).toBe(1);
  });

  it("paciente que ya existía en nuestra base: se liga por teléfono y solo se completan huecos", async () => {
    const ana = await db.patient.create({ data: { nombre: "Ana López", telefono: "+526670000001", fechaNac: new Date("1992-04-15") } });
    await ingestSwi([paciente({ id: "swi-ana", telefono: "667 000 0001", nombres: "Otra", primerApellido: "Persona", fechaNacimiento: "2000-01-01" })]);
    const p = await db.patient.findUniqueOrThrow({ where: { id: ana.id } });
    expect(p.nombre).toBe("Ana López");
    expect(p.fechaNac?.toISOString().slice(0, 10)).toBe("1992-04-15");
    expect(p.email).toBe("rosa@demo.mx"); // estaba vacío: se completa
  });

  it("pagos: se guardan aunque su trámite no haya llegado y nunca con un número de tarjeta completo", async () => {
    await ingestSwi([paciente(), tramite()]);
    const pago = { tipo: "PAGO", id: "pg1", tramiteId: "t1", monto: 320, moneda: "MXN", metodo: "TARJETA", estado: "APROBADO", marca: "VISA", ultimos4: "4242" };
    const r = await ingestSwi([
      pago,
      { ...pago, id: "pg2", tramiteId: "nope" },
      { ...pago, id: "pg3", numeroTarjeta: "4242424242424242" },
      { ...pago, id: "pg4", referencia: "4242 4242 4242 4242" },
      { ...pago, id: "pg5", referencia: "12345678901234567890" }, // referencia larga que no es tarjeta (falla Luhn)
    ]);
    expect(r.ok).toEqual(["pg1", "pg2", "pg5"]); // pg2: su trámite aún no llega, se guarda igual
    expect(r.errores.map((e) => e.id)).toEqual(["pg3", "pg4"]);
    expect(await db.swiPago.findUniqueOrThrow({ where: { id: "pg1" } })).toMatchObject({ ultimos4: "4242", marca: "VISA" });
  });

  it("eventos: van a la línea de tiempo de la paciente con su canal, una sola vez", async () => {
    await ingestSwi([paciente(), tramite()]);
    const ev = { tipo: "EVENTO", id: "e1", pacienteId: "p1", tramiteId: "t1", canal: "CLINICA", tipoEvento: "CHECK_IN", detalle: { sala: 2 }, fecha: "2026-12-01T15:55:00Z" };
    const msg = { tipo: "EVENTO", id: "e2", tramiteId: "t1", canal: "WHATSAPP", tipoEvento: "MENSAJE_RECIBIDO", detalle: { texto: "¿llevo orden médica?" }, fecha: "2026-12-01T15:00:00Z" };
    expect((await ingestSwi([ev, msg, ev])).ok).toEqual(["e1", "e2", "e1"]);

    const p = await db.patient.findUniqueOrThrow({ where: { telefono: "+526671112233" } });
    const timeline = await db.event.findMany({ where: { patientId: p.id, type: "SWI_EVENTO" }, orderBy: { seq: "asc" } });
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ channel: "SYSTEM", payload: { tipoEvento: "CHECK_IN", canal: "CLINICA" } });
    expect(timeline[0].createdAt.toISOString()).toBe("2026-12-01T15:55:00.000Z");
    expect(timeline[1]).toMatchObject({ channel: "WHATSAPP", payload: { texto: "¿llevo orden médica?" } });
  });

  it("orden libre: eventos antes que su paciente o trámite se guardan y pasan a la línea de tiempo cuando estos llegan", async () => {
    const r = await ingestSwi([
      { tipo: "EVENTO", id: "e1", pacienteId: "p1", tramiteId: null, canal: "CALL_CENTER", tipoEvento: "LLAMADA_RECIBIDA", detalle: { desde: "6671112233" }, fecha: "2026-11-01T10:00:00.000Z" },
      { tipo: "EVENTO", id: "e2", pacienteId: null, tramiteId: "t1", canal: "CLINICA", tipoEvento: "ALGO_NUEVO", detalle: { nota: "tipo desconocido" }, fecha: null },
      { tipo: "PAGO", id: "pg1", tramiteId: "t1", monto: null, moneda: null, metodo: null, estado: null, marca: null, ultimos4: null, referencia: "pi_prueba_YN5dceThwbIk", canal: null, creadoEn: null },
    ]);
    expect(r).toEqual({ ok: ["e1", "e2", "pg1"], errores: [] });
    expect(await db.event.count({ where: { type: "SWI_EVENTO" } })).toBe(0); // aún sin paciente

    await ingestSwi([paciente()]);
    expect(await db.event.count({ where: { type: "SWI_EVENTO" } })).toBe(1); // e1 se ligó por pacienteId
    await ingestSwi([tramite({ pacienteId: null, estudio: null, clinica: null, estado: null })]);
    const timeline = await db.event.findMany({ where: { type: "SWI_EVENTO" }, orderBy: { seq: "asc" } });
    expect(timeline.map((e) => (e.payload as { tipoEvento: string }).tipoEvento)).toEqual(["LLAMADA_RECIBIDA", "ALGO_NUEVO"]);
    expect(await db.swiEvento.count({ where: { patientId: null } })).toBe(0);
    expect(timeline[1].payload).toMatchObject({ canal: "CLINICA", texto: "tipo desconocido" });
  });

  it("registros inválidos o de paciente desconocido se reportan sin frenar el lote", async () => {
    const r = await ingestSwi([
      { tipo: "OTRA_COSA", id: "x1" },
      { tipo: "PACIENTE", id: "x2", telefono: "123" },
      paciente(),
    ]);
    expect(r.ok).toEqual(["p1"]);
    expect(r.errores).toEqual([
      { id: "x1", motivo: 'tipo desconocido: "OTRA_COSA"' },
      { id: "x2", motivo: expect.stringMatching(/teléfono inválido/) },
    ]);
  });

  it("TRAMITE_ELIMINADO marca el trámite (llegue antes o después) y lo saca del tablero", async () => {
    const borrado = (tramiteId: string, id: string) => ({
      tipo: "EVENTO", id, pacienteId: "p1", tramiteId: null, canal: "CALL_CENTER", tipoEvento: "TRAMITE_ELIMINADO",
      detalle: { tramiteId, estudio: "Rayos X de mano", motivo: "Duplicado", estadoPrevio: "AGENDADO" }, fecha: "2026-11-24T21:00:00.000Z",
    });
    await ingestSwi([paciente(), tramite(), borrado("t1", "e1")]); // después del trámite
    await ingestSwi([borrado("t2", "e2"), tramite({ id: "t2" })]); // antes del trámite
    await ingestSwi([tramite({ estado: "CONFIRMADO" })]); // una actualización posterior no lo "revive"
    for (const id of ["t1", "t2"]) expect(await db.swiTramite.findUniqueOrThrow({ where: { id } })).toMatchObject({ motivoEliminacion: "Duplicado", eliminadoEn: new Date("2026-11-24T21:00:00.000Z") });
    const o = await getSwiOverview();
    expect(o.kpis.total).toBe(0);
    expect(o.journeys).toHaveLength(0);
  });

  it("el mapa de un trámite incluye los eventos sin trámite de la paciente mientras ese era su trámite", async () => {
    await ingestSwi([
      paciente(),
      tramite({ creadoEn: "2026-11-24T20:00:00.000Z" }),
      tramite({ id: "t2", creadoEn: "2026-11-24T22:00:00.000Z" }),
      { tipo: "EVENTO", id: "e1", pacienteId: "p1", tramiteId: null, canal: "CALL_CENTER", tipoEvento: "LLAMADA_RECIBIDA", detalle: { desde: "5614318300", proveedor: "android" }, fecha: "2026-11-24T21:26:27.000Z" },
      { tipo: "EVENTO", id: "e2", pacienteId: "p1", tramiteId: null, canal: "WHATSAPP", tipoEvento: "MENSAJE_RECIBIDO", detalle: { texto: "hola" }, fecha: "2026-11-24T22:30:00.000Z" },
    ]);
    const t1 = (await getSwiJourney("t1"))!.detail.timeline.map((e) => (e.payload as { swiId: string }).swiId);
    const t2 = (await getSwiJourney("t2"))!.detail.timeline.map((e) => (e.payload as { swiId: string }).swiId);
    expect(t1).toEqual(["e1"]); // la llamada fue mientras t1 era su trámite más reciente
    expect(t2).toEqual(["e2"]);
  });

  it("resúmenes legibles de los eventos nuevos", () => {
    expect(resumen("CITA_PARA_FAMILIAR", { familiar: "Sofía López García", parentesco: "HIJO", parentescoTexto: "hija", estudio: "Papanicolaou", clinica: "Salud Digna Mazatlán" }))
      .toBe("Para Sofía López García (hija) · Papanicolaou · Salud Digna Mazatlán");
    expect(resumen("CITA_AGENDADA", { agendadaPor: "su madre, Ana López García", clinica: "Salud Digna Mazatlán" })).toBe("Agendada por su madre, Ana López García · Salud Digna Mazatlán");
    expect(resumen("REPORTE_ENVIADO", { folio: "SD-1", pago: "EN_CLINICA", estudios: ["ECG", "PAP"], ruta: "/reportes/x.pdf" })).toBe("Folio SD-1 · paga en clínica · 2 estudios");
    expect(resumen("LLAMADA_RECIBIDA", { desde: "5614318300", proveedor: "android" })).toBe("Desde el ••8300 · android");
    expect(resumen("TRAMITE_ELIMINADO", { estudio: "ECG", motivo: "Duplicado" })).toBe("ECG · Duplicado");
  });

  it("cita agendada o confirmada en SWI: un aviso por WhatsApp por trámite, solo al insertar y solo si es reciente", async () => {
    await ingestSwi([paciente(), tramite()]);
    const ahora = new Date().toISOString();
    const agendada = { tipo: "EVENTO", id: "e10", pacienteId: "p1", tramiteId: "t1", canal: "CALL_CENTER", tipoEvento: "CITA_AGENDADA", detalle: {}, fecha: ahora };
    await ingestSwi([agendada, agendada]); // reenvío del mismo id: no repite
    await ingestSwi([{ ...agendada, id: "e11", tipoEvento: "CITA_CONFIRMADA" }]); // mismo trámite: no repite
    await ingestSwi([tramite({ id: "t2" }), { ...agendada, id: "e12", tramiteId: "t2", fecha: "2026-01-01T10:00:00Z" }]); // vieja: sin aviso

    const p = await db.patient.findUniqueOrThrow({ where: { telefono: "+526671112233" } });
    const avisos = await db.event.findMany({ where: { patientId: p.id, type: "MESSAGE_OUT" } });
    expect(avisos).toHaveLength(1);
    const identity = await db.channelIdentity.findUniqueOrThrow({ where: { channel_externalId: { channel: "WHATSAPP", externalId: "+526671112233" } } });
    const aviso = avisos[0].payload as { identityId: string; text: string };
    expect(aviso.identityId).toBe(identity.id);
    expect(aviso.text).toContain("agendada en Call Center");
    expect(aviso.text).toContain("Folio: *SD-T1*"); // folio visible: SD- + últimos 6 del id
    expect(aviso.text).toContain("Rayos X de mano");
    expect(aviso.text).toContain("Clínica Navolato");
  });

  it("CONTEXTO_CONSULTADO se guarda pero no pasa a la línea de tiempo ni al resumen", async () => {
    await ingestSwi([paciente(), tramite()]);
    const base = { tipo: "EVENTO", pacienteId: "p1", tramiteId: "t1", detalle: {}, fecha: "2026-12-01T15:00:00Z" };
    await ingestSwi([
      { ...base, id: "e20", canal: "CALL_CENTER", tipoEvento: "CONTEXTO_CONSULTADO" },
      { ...base, id: "e21", canal: "WHATSAPP", tipoEvento: "PAGO_APROBADO", detalle: { monto: 320 } },
    ]);
    expect(await db.swiEvento.count()).toBe(2);
    const p = await db.patient.findUniqueOrThrow({ where: { telefono: "+526671112233" } });
    const events = await db.event.findMany({ where: { patientId: p.id }, orderBy: { seq: "asc" } });
    expect(events.map((e) => (e.payload as { tipoEvento?: string }).tipoEvento)).toEqual(["PAGO_APROBADO"]);
    // Resumen del asesor: el evento de SWI con su canal; al LLM, sin el teléfono de la paciente.
    expect(summarizeJourney(events, null).lines.join(" ")).toContain("En SWI: Pago aprobado (WhatsApp)");
    const facts = journeyFacts(events, null);
    expect(facts).toContain("SWI · Pago aprobado (WhatsApp)");
    expect(facts).not.toContain("6671112233");
  });

  it("«Mis citas»: agendada o confirmada = próxima (o pasada), cancelada, y el resto a medias", () => {
    const futuro = new Date(Date.now() + 86400_000);
    const pasado = new Date(Date.now() - 86400_000);
    expect(swiGrupo("CONFIRMADO", futuro)).toBe("PROXIMA");
    expect(swiGrupo("AGENDADO", null)).toBe("PROXIMA");
    expect(swiGrupo("AGENDADO", pasado)).toBe("PASADA");
    expect(swiGrupo("CANCELADO", futuro)).toBe("CANCELADA");
    for (const e of ["COTIZANDO", "CLINICA_SELECCIONADA", "DATOS_CAPTURADOS", "ABANDONADO", null]) expect(swiGrupo(e, null)).toBe("A_MEDIAS");
  });

  it("prospecto sin fecha de nacimiento: el asesor lo valida con su celular y el folio o el estudio de su cotización", async () => {
    await ingestSwi([tramite({ id: "cotizacion01abc9", estado: "ABANDONADO", folioExterno: "VT-77" })]);
    const p = await db.patient.findUniqueOrThrow({ where: { telefono: "+526671112233" } });
    expect(p.fechaNac).toBeNull();
    const staff = await db.staffUser.upsert({ where: { email: "asesor-swi@test.mx" }, create: { email: "asesor-swi@test.mx", nombre: "Asesor", passwordHash: "x", role: "ASESOR" }, update: {} });

    expect(await matchesQuote(p.id, "sd-01abc9")).toBe(true); // SD- + últimos 6 del id
    expect(await matchesQuote(p.id, "vt-77")).toBe(true);
    expect(await matchesQuote(p.id, "rayos x de mano")).toBe(true);
    expect(await matchesQuote(p.id, "Mastografía")).toBe(false);
    expect(await verifyByStaff(staff.id, p.id, { last4: "2233", referencia: "Rayos X" })).toBe(true);
    expect(await verifyByStaff(staff.id, p.id, { last4: "0000", referencia: "Rayos X" })).toBe(false); // el celular también cuenta

    // Captura de sus datos en ese contacto; no pisa datos que ya existen.
    await captureProspectData(staff.id, p.id, { nombre: "Rosa Díaz", fechaNac: "1988-07-09" });
    expect(await db.patient.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ nombre: "Rosa Díaz" });
    await expect(captureProspectData(staff.id, p.id, { nombre: "Otra", fechaNac: "1990-01-01" })).rejects.toThrow("ya tiene sus datos");
  });

  it("llave y detector de tarjetas", () => {
    process.env.SWI_API_KEY = "k".repeat(32);
    expect(validSwiKey("k".repeat(32))).toBe(true);
    expect(validSwiKey("k".repeat(31))).toBe(false);
    expect(validSwiKey(null)).toBe(false);
    expect(hasCardNumber("pago 4111-1111-1111-1111 ok")).toBe(true);
    expect(hasCardNumber("6671112233")).toBe(false);
  });
});
