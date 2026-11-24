import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "@/test/db";
import { advance, createCase } from "./case";
import { channelPath, getOverview, journeyStatus, PAUSE_AFTER_MS } from "./overview";

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe("tablero admin", () => {
  it("estado del recorrido: activo, pausado, confirmado, cancelado", () => {
    const now = Date.now();
    expect(journeyStatus("CLINICA_ELEGIDA", new Date(now - 1000), now)).toBe("ACTIVO");
    expect(journeyStatus("CLINICA_ELEGIDA", new Date(now - PAUSE_AFTER_MS - 1), now)).toBe("PAUSADO");
    expect(journeyStatus("CITA_CONFIRMADA", new Date(0), now)).toBe("CONFIRMADO");
    expect(journeyStatus("CANCELADO", new Date(0), now)).toBe("CANCELADO");
  });

  it("ruta de canales sin repetidos consecutivos", () => {
    expect(channelPath(["WEB", "WEB", "WHATSAPP", "WHATSAPP", "CALL_CENTER", "WEB"])).toEqual(["WEB", "WHATSAPP", "CALL_CENTER", "WEB"]);
  });

  it("KPIs, etapas, transiciones y recorridos a partir de los eventos", async () => {
    const p = await db.patient.create({ data: { nombre: "Ana", telefono: "+526670000001", fechaNac: new Date("1992-04-15") } });
    const a = await createCase({ channel: "WEB", patientId: p.id });
    await advance({ caseId: a.id, to: "ESTUDIO_ELEGIDO", data: { studyId: "us" }, channel: "WEB", expectedVersion: 1 });
    await advance({ caseId: a.id, to: "CLINICA_ELEGIDA", data: { clinicId: "c1" }, channel: "WHATSAPP", expectedVersion: 2 });
    await advance({ caseId: a.id, to: "CANCELADO", data: {}, channel: "CALL_CENTER", expectedVersion: 3 });
    const b = await createCase({ channel: "APP", patientId: p.id });
    await advance({ caseId: b.id, to: "ESTUDIO_ELEGIDO", data: { studyId: "us" }, channel: "APP", expectedVersion: 1 });

    const o = await getOverview();
    expect(o.kpis).toMatchObject({ open: 1, paused: 0, switches24h: 2, multichannelPct: 50 });
    expect(o.steps).toEqual({ CANCELADO: 1, ESTUDIO_ELEGIDO: 1 });
    expect(o.transitions).toEqual({ WEB: { WHATSAPP: 1 }, WHATSAPP: { CALL_CENTER: 1 } });
    const ja = o.journeys.find((j) => j.caseId === a.id)!;
    expect(ja).toMatchObject({ paciente: "Ana", status: "CANCELADO", channels: ["WEB", "WHATSAPP", "CALL_CENTER"] });
  });
});
