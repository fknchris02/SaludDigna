import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { advance, createCase, getActiveCase } from "@/lib/engine/case";
import { getOrCreateChannelIdentity, requestOtp, verifyAndLink } from "@/lib/engine/identity";
import { resetDb } from "@/test/db";
import { slots } from "@/lib/format";
import { catchUp, handleInboundMessage, parseDate, pickOption } from "./whatsapp";

const ANA = "667 000 0001";
let n = 0;
const send = (text: string, from = ANA, messageId = `m${++n}`) => handleInboundMessage({ from, text, messageId });
const texts = (r: Awaited<ReturnType<typeof send>>) => r.replies.map((x) => x.text).join("\n");

async function createAna() {
  return db.patient.create({ data: { nombre: "Ana López", telefono: "+526670000001", fechaNac: new Date("1992-04-15") } });
}

/** Ana empieza en la web: anónima elige estudio y clínica, verifica su teléfono y cierra la pestaña. */
async function anaStartsOnWeb() {
  await createAna();
  const web = await getOrCreateChannelIdentity("WEB", "cookie-ana");
  const c = await createCase({ channel: "WEB", anonIdentityId: web.id });
  await advance({ caseId: c.id, to: "ESTUDIO_ELEGIDO", data: { studyId: "us" }, channel: "WEB", expectedVersion: 1 });
  await advance({ caseId: c.id, to: "CLINICA_ELEGIDA", data: { clinicId: "c1" }, channel: "WEB", expectedVersion: 2 });
  const { code } = await requestOtp(ANA, "WEB");
  await verifyAndLink({ identityId: web.id, telefono: ANA, code });
  return c;
}

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe("utilidades", () => {
  it("parseDate acepta formatos comunes y rechaza fechas inválidas o futuras", () => {
    expect(parseDate("15/04/1992")).toBe("1992-04-15");
    expect(parseDate("5-4-1992")).toBe("1992-04-05");
    expect(parseDate("1992-04-15")).toBe("1992-04-15");
    expect(parseDate("31/02/1992")).toBeNull();
    expect(parseDate("01/01/2999")).toBeNull();
    expect(parseDate("hola")).toBeNull();
  });

  it("pickOption por número, por texto único o nada si es ambiguo", () => {
    const opts = [
      { label: "Sí, son correctos", value: "a" },
      { label: "Cambiar horario", value: "b" },
      { label: "Cambiar clínica", value: "c" },
    ];
    expect(pickOption(opts, "1")?.value).toBe("a");
    expect(pickOption(opts, "si")?.value).toBe("a");
    expect(pickOption(opts, "cambiar horario")?.value).toBe("b");
    expect(pickOption(opts, "cambiar")).toBeNull();
    expect(pickOption(opts, "9")).toBeNull();
  });

  it("slots: 6 horarios futuros, ninguno en domingo", () => {
    const s = slots(new Date("2026-11-21T12:00:00-07:00")); // sábado
    expect(s).toHaveLength(6);
    expect(s[0]).toBe("2026-11-23T08:00:00-07:00"); // salta el domingo 22
  });
});

describe("recorrido de Ana: Web → WhatsApp", () => {
  it("verifica identidad, retoma el trámite de la web sin repetir datos y confirma la cita", async () => {
    const c = await anaStartsOnWeb();

    expect(texts(await send("Hola"))).toMatch(/fecha de nacimiento/);
    expect(texts(await send("01/01/1990"))).toMatch(/no coinciden/);

    const resumed = await send("15/04/1992");
    expect(texts(resumed)).toMatch(/Gracias, Ana/);
    expect(texts(resumed)).toMatch(/iniciaste en el sitio web/);
    expect(texts(resumed)).toMatch(/Ultrasonido[\s\S]*Clínica Centro/);
    expect(resumed.replies.at(-1)?.options).toHaveLength(6); // pide horario: lo que faltaba

    const horario = await send("2");
    expect(texts(horario)).toMatch(/Confirma tus datos/);

    // Pregunta libre a mitad del trámite: se responde con el contexto y se repite la pregunta pendiente.
    const ayuno = await send("¿necesito ayuno?");
    expect(texts(ayuno)).toMatch(/Ayuno de 6 horas/);
    expect(texts(ayuno)).toMatch(/Confirma tus datos/);

    await send("si");
    const done = await send("Confirmar cita");
    expect(texts(done)).toMatch(/Cita confirmada[\s\S]*Folio: \*SD-/);

    const final = await db.case.findUniqueOrThrow({ where: { id: c.id } });
    expect(final.step).toBe("CITA_CONFIRMADA");
    const timeline = await db.event.findMany({ where: { caseId: c.id, type: "CASE_RESUMED" } });
    expect(timeline.map((e) => e.payload)).toContainEqual({ from: "WEB", to: "WHATSAPP", step: "CLINICA_ELEGIDA" });
  });

  it("un mensaje repetido (mismo id del proveedor) no responde ni avanza dos veces", async () => {
    const c = await anaStartsOnWeb();
    await send("hola");
    await send("15/04/1992");
    const first = await send("1", ANA, "dup-1");
    const again = await send("1", ANA, "dup-1");
    expect(first.duplicate).toBe(false);
    expect(again).toEqual({ replies: [], duplicate: true });
    expect((await db.case.findUniqueOrThrow({ where: { id: c.id } })).step).toBe("HORARIO_ELEGIDO");
  });

  it("si el asesor avanzó el trámite, una opción vieja de WhatsApp no se aplica: se retoma con lo nuevo", async () => {
    const c = await anaStartsOnWeb();
    await send("hola");
    await send("15/04/1992"); // WhatsApp ofrece horarios
    const cur = await db.case.findUniqueOrThrow({ where: { id: c.id } });
    await advance({ caseId: c.id, to: "HORARIO_ELEGIDO", data: { horario: slots()[5] }, channel: "CALL_CENTER", expectedVersion: cur.version });

    const r = await send("1"); // opción vieja
    expect(texts(r)).toMatch(/iniciaste en el Call Center/);
    expect(texts(r)).toMatch(/Confirma tus datos/);
    expect((await db.case.findUniqueOrThrow({ where: { id: c.id } })).data).toMatchObject({ horario: slots()[5] });
  });

  it("al abrir WhatsApp avisa lo que se cerró en otros canales y ofrece el trámite nuevo pendiente", async () => {
    const c = await anaStartsOnWeb();
    await send("hola");
    await send("15/04/1992"); // WhatsApp ofrece horarios de c
    // El asesor termina c y Ana abre otro trámite en la web.
    let v = (await db.case.findUniqueOrThrow({ where: { id: c.id } })).version;
    for (const [to, data] of [["HORARIO_ELEGIDO", { horario: slots()[0] }], ["DATOS_CONFIRMADOS", {}], ["CITA_CONFIRMADA", {}]] as const) {
      v = (await advance({ caseId: c.id, to, data, channel: "CALL_CENTER", expectedVersion: v })).case.version;
    }
    const patientId = (await db.case.findUniqueOrThrow({ where: { id: c.id } })).patientId!;
    const c2 = await createCase({ channel: "WEB", patientId });
    await advance({ caseId: c2.id, to: "ESTUDIO_ELEGIDO", data: { studyId: "us" }, channel: "WEB", expectedVersion: 1 });
    await advance({ caseId: c2.id, to: "CLINICA_ELEGIDA", data: { clinicId: "c1" }, channel: "WEB", expectedVersion: 2 });

    const outbox = async () => (await db.event.findMany({ where: { type: "MESSAGE_OUT" }, orderBy: { seq: "asc" } })).map((e) => (e.payload as { text: string }).text);
    const before = (await outbox()).length;
    await Promise.all([catchUp("+526670000001"), catchUp("+526670000001")]); // dos pestañas a la vez
    const avisos = (await outbox()).slice(before).join("\n");
    expect(avisos).toMatch(/cita quedó confirmada desde el Call Center[\s\S]*Folio: \*SD-/);
    expect(avisos).toMatch(/trámite pendiente[\s\S]*Elige un horario/);
    expect((await outbox()).length - before).toBe(3); // sin duplicados
    await catchUp("+526670000001");
    expect((await outbox()).length - before).toBe(3); // ya al día: no repite

    await send("1"); // elige horario directamente, sin otro mensaje de "retomar"
    expect((await db.case.findUniqueOrThrow({ where: { id: c2.id } })).step).toBe("HORARIO_ELEGIDO");
  });

  it("cancelar pide confirmación", async () => {
    const c = await anaStartsOnWeb();
    await send("hola");
    await send("15/04/1992");
    expect(texts(await send("quiero cancelar"))).toMatch(/Seguro/);
    expect(texts(await send("1"))).toMatch(/cancelado/);
    expect((await db.case.findUniqueOrThrow({ where: { id: c.id } })).step).toBe("CANCELADO");
  });
});

describe("número nuevo en WhatsApp", () => {
  it("registra al paciente y empieza un trámite desde cero", async () => {
    const tel = "667 999 9999";
    await send("hola", tel);
    expect(texts(await send("20/01/1999", tel))).toMatch(/nombre completo/);
    const r = await send("Sofía Medina", tel);
    expect(texts(r)).toMatch(/Gracias, Sofía/);
    expect(texts(r)).toMatch(/Qué estudio/);
    await send("1", tel);
    const p = await db.patient.findUniqueOrThrow({ where: { telefono: "+526679999999" } });
    expect(p.fechaNac.toISOString().slice(0, 10)).toBe("1999-01-20");
    expect((await getActiveCase(p.id))?.step).toBe("ESTUDIO_ELEGIDO");
  });
});
