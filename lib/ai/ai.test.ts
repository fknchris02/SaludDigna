import type { Event } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { slots } from "@/lib/format";
import { resetDb } from "@/test/db";

// Cliente de Claude simulado: las pruebas nunca llaman al API real.
const parse = vi.fn();
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), getAi: () => ({ beta: { messages: { parse } } }) }));

const { classifyMessage } = await import("./intent");
const { redact } = await import("./client");
const { summarizeWithAI } = await import("./summary");
const { handleInboundMessage } = await import("@/lib/channels/whatsapp");
const { advance, createCase } = await import("@/lib/engine/case");

const llm = (parsed_output: unknown, stop_reason = "end_turn") => parse.mockResolvedValueOnce({ parsed_output, stop_reason });

beforeEach(async () => {
  parse.mockReset();
  await resetDb();
});
afterAll(() => db.$disconnect());

describe("clasificación con IA", () => {
  it("si las reglas bastan, no llama al LLM", async () => {
    expect(await classifyMessage("quiero cancelar")).toEqual({ intent: "CANCELAR", option: null, source: "rules" });
    expect(parse).not.toHaveBeenCalled();
  });

  it("el LLM interpreta texto libre como una de las opciones ofrecidas", async () => {
    llm({ intent: "OTRO", option: 2 });
    const r = await classifyMessage("mejor el de las 10", ["lun 08:00", "lun 10:00", "lun 12:00"]);
    expect(r).toEqual({ intent: "OTRO", option: 2, source: "llm" });
    const req = parse.mock.calls[0][0];
    expect(req.fallbacks).toBe("default");
    expect(req.output_config.effort).toBe("low");
  });

  it("descarta una opción fuera de rango", async () => {
    llm({ intent: "OTRO", option: 9 });
    expect((await classifyMessage("la novena", ["a", "b"])).option).toBeNull();
  });

  it("si el LLM falla o declina, regresa a reglas", async () => {
    parse.mockRejectedValueOnce(new Error("timeout"));
    expect(await classifyMessage("mmm no sé")).toEqual({ intent: "OTRO", option: null, source: "rules" });
    llm(null, "refusal");
    expect((await classifyMessage("mmm no sé")).source).toBe("rules");
  });

  it("no manda teléfonos ni correos al LLM", async () => {
    expect(redact("llámame al 667 123 4567 o a ana@demo.mx")).toBe("llámame al [número] o a [correo]");
    llm({ intent: "OTRO", option: null });
    await classifyMessage("mi cel es 6671234567");
    expect(JSON.stringify(parse.mock.calls[0][0].messages)).not.toContain("6671234567");
  });
});

describe("WhatsApp con IA", () => {
  it("el paciente elige horario con sus palabras y el trámite avanza", async () => {
    const p = await db.patient.create({ data: { nombre: "Ana López", telefono: "+526670000001", fechaNac: new Date("1992-04-15") } });
    const c = await createCase({ channel: "WEB", patientId: p.id });
    await advance({ caseId: c.id, to: "ESTUDIO_ELEGIDO", data: { studyId: "us" }, channel: "WEB", expectedVersion: 1 });
    await advance({ caseId: c.id, to: "CLINICA_ELEGIDA", data: { clinicId: "c1" }, channel: "WEB", expectedVersion: 2 });
    await handleInboundMessage({ from: "6670000001", text: "hola", messageId: "a" });
    await handleInboundMessage({ from: "6670000001", text: "15/04/1992", messageId: "b" }); // le ofrece 6 horarios

    llm({ intent: "OTRO", option: 4 });
    const r = await handleInboundMessage({ from: "6670000001", text: "el segundo día tempranito porfa", messageId: "c" });
    expect(r.replies.map((x) => x.text).join("\n")).toMatch(/Confirma tus datos/);
    expect((await db.case.findUniqueOrThrow({ where: { id: c.id } })).data).toMatchObject({ horario: slots()[3] });
    const ev = await db.event.findFirst({ where: { type: "INTENT_CLASSIFIED", caseId: c.id } });
    expect(ev?.payload).toMatchObject({ intent: "ELEGIR_OPCION", source: "llm" });
  });
});

describe("resumen con IA", () => {
  const ev = (seq: number, type: string, payload = {}): Event =>
    ({ seq: BigInt(seq), type, channel: "WHATSAPP", payload, createdAt: new Date(), caseId: null, patientId: null, actorId: null, idempotencyKey: null }) as Event;

  it("usa el LLM, cachea por último evento y regresa a reglas si falla", async () => {
    llm({ lines: ["Ana quiere un ultrasonido.", "Falta elegir horario."] });
    const events = [ev(1, "CASE_CREATED"), ev(2, "MESSAGE_IN", { text: "¿necesito ayuno?" })];
    expect(await summarizeWithAI(events, null)).toEqual({ lines: ["Ana quiere un ultrasonido.", "Falta elegir horario."], source: "llm" });
    await summarizeWithAI(events, null); // mismo último evento → caché
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse.mock.calls[0][0].messages[0].content).toContain("¿necesito ayuno?");

    parse.mockRejectedValueOnce(new Error("500"));
    expect((await summarizeWithAI([...events, ev(3, "CASE_RESUMED", { from: "WEB", to: "WHATSAPP" })], null)).source).toBe("rules");
  });
});
