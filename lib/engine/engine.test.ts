import type { Event } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { advance, canTransition, createCase, EngineError, getActiveCase, pendingStep, resumeCase } from "./case";
import { bus } from "./events";
import { getOrCreateChannelIdentity, normalizePhone, requestOtp, verifyAndLink, verifyByBirthdate } from "./identity";

const future = new Date(Date.now() + 86_400_000).toISOString();

async function reset() {
  await db.event.deleteMany();
  await db.case.deleteMany();
  await db.channelIdentity.deleteMany();
  await db.otpChallenge.deleteMany();
  await db.patient.deleteMany();
  await db.study.upsert({ where: { id: "us" }, update: {}, create: { id: "us", nombre: "Ultrasonido", precio: 45000, preparacion: "Ayuno" } });
  await db.clinic.upsert({ where: { id: "c1" }, update: {}, create: { id: "c1", nombre: "Centro", ciudad: "Culiacán", direccion: "x" } });
}

async function newPatientCase() {
  const p = await db.patient.create({ data: { nombre: "Ana", telefono: "+526670000001", fechaNac: new Date("1992-04-15") } });
  return { p, c: await createCase({ channel: "WEB", patientId: p.id }) };
}

async function expectCode(promise: Promise<unknown>, code: EngineError["code"]) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof EngineError && e.code === code);
}

beforeEach(reset);
afterAll(() => db.$disconnect());

describe("reglas puras", () => {
  it("transiciones: avanzar uno, repetir, regresar, cancelar; no saltar ni reabrir", () => {
    expect(canTransition("INICIADO", "ESTUDIO_ELEGIDO")).toBe(true);
    expect(canTransition("INICIADO", "CLINICA_ELEGIDA")).toBe(false);
    expect(canTransition("HORARIO_ELEGIDO", "CLINICA_ELEGIDA")).toBe(true);
    expect(canTransition("CLINICA_ELEGIDA", "CLINICA_ELEGIDA")).toBe(true);
    expect(canTransition("CITA_CONFIRMADA", "HORARIO_ELEGIDO")).toBe(false);
    expect(canTransition("CITA_CONFIRMADA", "CANCELADO")).toBe(true);
    expect(canTransition("CANCELADO", "ESTUDIO_ELEGIDO")).toBe(false);
    expect(pendingStep("CLINICA_ELEGIDA")).toBe("HORARIO_ELEGIDO");
    expect(pendingStep("CITA_CONFIRMADA")).toBeNull();
  });

  it("normaliza teléfonos MX a E.164", () => {
    expect(normalizePhone("667 000 0001")).toBe("+526670000001");
    expect(normalizePhone("+52 1 667 000 0001")).toBe("+526670000001");
    expect(normalizePhone("whatsapp:+526670000001")).toBe("+526670000001");
    expect(() => normalizePhone("12345")).toThrow(EngineError);
  });
});

describe("advance()", () => {
  it("recorre el flujo completo, guarda contexto y genera folio", async () => {
    const { c } = await newPatientCase();
    let v = c.version;
    const step = async (to: Parameters<typeof advance>[0]["to"], data = {}) =>
      (v = (await advance({ caseId: c.id, to, data, channel: "WEB", expectedVersion: v })).case.version);
    await step("ESTUDIO_ELEGIDO", { studyId: "us" });
    await step("CLINICA_ELEGIDA", { clinicId: "c1" });
    await step("HORARIO_ELEGIDO", { horario: future });
    await step("DATOS_CONFIRMADOS");
    await step("CITA_CONFIRMADA");
    const done = await db.case.findUniqueOrThrow({ where: { id: c.id } });
    expect(done.step).toBe("CITA_CONFIRMADA");
    expect(done.data).toMatchObject({ estudio: "Ultrasonido", clinica: "Centro", horario: future, folio: expect.stringMatching(/^SD-/) });
    expect(done.version).toBe(6);
    expect(await getActiveCase(done.patientId!)).toBeNull();
  });

  it("rechaza saltar pasos y datos inválidos", async () => {
    const { c } = await newPatientCase();
    await expectCode(advance({ caseId: c.id, to: "CLINICA_ELEGIDA", data: { clinicId: "c1" }, channel: "WEB", expectedVersion: 1 }), "INVALID_TRANSITION");
    await expectCode(advance({ caseId: c.id, to: "ESTUDIO_ELEGIDO", data: { studyId: "nope" }, channel: "WEB", expectedVersion: 1 }), "INVALID_DATA");
    await expectCode(advance({ caseId: c.id, to: "ESTUDIO_ELEGIDO", data: {}, channel: "WEB", expectedVersion: 1 }), "INVALID_DATA");
  });

  it("al regresar a un paso borra los datos de los pasos posteriores", async () => {
    const { c } = await newPatientCase();
    await advance({ caseId: c.id, to: "ESTUDIO_ELEGIDO", data: { studyId: "us" }, channel: "WEB", expectedVersion: 1 });
    await advance({ caseId: c.id, to: "CLINICA_ELEGIDA", data: { clinicId: "c1" }, channel: "WEB", expectedVersion: 2 });
    await advance({ caseId: c.id, to: "HORARIO_ELEGIDO", data: { horario: future }, channel: "WEB", expectedVersion: 3 });
    const r = await advance({ caseId: c.id, to: "CLINICA_ELEGIDA", data: { clinicId: "c1" }, channel: "WEB", expectedVersion: 4 });
    expect(r.case.data).not.toHaveProperty("horario");
    expect(r.case.data).toHaveProperty("estudio");
  });

  it("no confirma datos de un visitante anónimo", async () => {
    const id = await getOrCreateChannelIdentity("WEB", "cookie-1");
    const c = await createCase({ channel: "WEB", anonIdentityId: id.id });
    await advance({ caseId: c.id, to: "ESTUDIO_ELEGIDO", data: { studyId: "us" }, channel: "WEB", expectedVersion: 1 });
    await advance({ caseId: c.id, to: "CLINICA_ELEGIDA", data: { clinicId: "c1" }, channel: "WEB", expectedVersion: 2 });
    await advance({ caseId: c.id, to: "HORARIO_ELEGIDO", data: { horario: future }, channel: "WEB", expectedVersion: 3 });
    await expectCode(advance({ caseId: c.id, to: "DATOS_CONFIRMADOS", channel: "WEB", expectedVersion: 4 }), "IDENTITY_REQUIRED");
  });

  it("idempotencia: la misma llave no avanza dos veces, ni en paralelo", async () => {
    const { c } = await newPatientCase();
    const input = { caseId: c.id, to: "ESTUDIO_ELEGIDO" as const, data: { studyId: "us" }, channel: "WHATSAPP" as const, expectedVersion: 1, idempotencyKey: "SM123" };
    const [a, b] = await Promise.all([advance(input), advance(input)]);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    const again = await advance(input);
    expect(again.duplicate).toBe(true);
    expect((await db.case.findUniqueOrThrow({ where: { id: c.id } })).version).toBe(2);
    expect(await db.event.count({ where: { caseId: c.id, type: "STEP_COMPLETED" } })).toBe(1);
  });

  it("bloqueo optimista: dos canales con la misma versión → uno gana, el otro recibe CONFLICT y queda registrado", async () => {
    const { c } = await newPatientCase();
    const web = advance({ caseId: c.id, to: "ESTUDIO_ELEGIDO", data: { studyId: "us" }, channel: "WEB", expectedVersion: 1 });
    const call = advance({ caseId: c.id, to: "CANCELADO", data: {}, channel: "CALL_CENTER", expectedVersion: 1 });
    const results = await Promise.allSettled([web, call]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "CONFLICT", details: { currentVersion: 2 } });
    expect(await db.event.count({ where: { caseId: c.id, type: "CONFLICT_DETECTED" } })).toBe(1);
  });

  it("cambio de canal: registra CASE_RESUMED con origen y destino", async () => {
    const { c } = await newPatientCase();
    await advance({ caseId: c.id, to: "ESTUDIO_ELEGIDO", data: { studyId: "us" }, channel: "WEB", expectedVersion: 1 });
    await resumeCase(c.id, "WHATSAPP");
    await advance({ caseId: c.id, to: "CLINICA_ELEGIDA", data: { clinicId: "c1" }, channel: "WHATSAPP", expectedVersion: 2 });
    await advance({ caseId: c.id, to: "HORARIO_ELEGIDO", data: { horario: future }, channel: "CALL_CENTER", expectedVersion: 3 });
    const resumed = await db.event.findMany({ where: { caseId: c.id, type: "CASE_RESUMED" }, orderBy: { seq: "asc" } });
    expect(resumed.map((e) => e.payload)).toEqual([
      { from: "WEB", to: "WHATSAPP", step: "ESTUDIO_ELEGIDO" },
      { from: "WHATSAPP", to: "CALL_CENTER", step: "CLINICA_ELEGIDA" },
    ]);
  });

  it("publica en el bus solo lo que se guardó", async () => {
    const { c } = await newPatientCase();
    const seen: Event[] = [];
    const on = (e: Event) => seen.push(e);
    bus.on("event", on);
    await advance({ caseId: c.id, to: "ESTUDIO_ELEGIDO", data: { studyId: "us" }, channel: "WEB", expectedVersion: 1 });
    await advance({ caseId: c.id, to: "CLINICA_ELEGIDA", data: { clinicId: "c1" }, channel: "WEB", expectedVersion: 1 }).catch(() => {});
    bus.off("event", on);
    expect(seen.map((e) => e.type)).toEqual(["STEP_COMPLETED", "CONFLICT_DETECTED"]);
  });
});

describe("identidad", () => {
  it("visitante anónimo en web verifica OTP y su trámite pasa al paciente", async () => {
    const id = await getOrCreateChannelIdentity("WEB", "cookie-ana");
    const c = await createCase({ channel: "WEB", anonIdentityId: id.id });
    await advance({ caseId: c.id, to: "ESTUDIO_ELEGIDO", data: { studyId: "us" }, channel: "WEB", expectedVersion: 1 });
    const { code } = await requestOtp("667 000 0001", "WEB");
    const p = await verifyAndLink({ identityId: id.id, telefono: "6670000001", code, perfil: { nombre: "Ana", fechaNac: "1992-04-15" } });
    expect((await getActiveCase(p.id))?.id).toBe(c.id);
    expect(await db.event.count({ where: { caseId: c.id, patientId: null } })).toBe(0);
  });

  it("OTP: código incorrecto falla, se bloquea tras 3 intentos y no se reutiliza", async () => {
    const id = await getOrCreateChannelIdentity("APP", "u1");
    const { code } = await requestOtp("6670000001", "APP");
    const wrong = code === "000000" ? "111111" : "000000";
    const link = (k: string) => verifyAndLink({ identityId: id.id, telefono: "6670000001", code: k, perfil: { nombre: "A", fechaNac: "1992-04-15" } });
    for (let i = 0; i < 3; i++) await expectCode(link(wrong), "IDENTITY_REQUIRED");
    await expectCode(link(code), "IDENTITY_REQUIRED"); // bloqueado aunque ahora sea correcto

    const fresh = await requestOtp("6670000001", "APP");
    await link(fresh.code);
    await expectCode(link(fresh.code), "IDENTITY_REQUIRED"); // ya usado
  });

  it("WhatsApp: fecha de nacimiento como segundo factor, con límite de intentos", async () => {
    await db.patient.create({ data: { nombre: "Ana", telefono: "+526670000001", fechaNac: new Date("1992-04-15") } });
    const id = await getOrCreateChannelIdentity("WHATSAPP", "whatsapp:+5216670000001");
    expect(await verifyByBirthdate(id.id, "1990-01-01")).toBeNull();
    expect((await verifyByBirthdate(id.id, "1992-04-15"))?.nombre).toBe("Ana");

    for (let i = 0; i < 2; i++) await verifyByBirthdate(id.id, "1990-01-01");
    await expectCode(verifyByBirthdate(id.id, "1992-04-15"), "IDENTITY_REQUIRED");
  });
});
