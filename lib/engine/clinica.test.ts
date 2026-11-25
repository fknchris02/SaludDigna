import type { Event } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/integrations/clinica/events/route";
import { db } from "@/lib/db";
import { resetDb } from "@/test/db";
import { advance, createCase } from "./case";
import { ingestClinicEvent } from "./clinica";
import { bus, EventType } from "./events";
import { getOverview } from "./overview";

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe("integración en tiempo real WEB-CLINICA", () => {
  it("rechaza webhook sin secreto o con secreto inválido y acepta uno válido", async () => {
    const prev = process.env.CLINICA_WEBHOOK_SECRET;
    process.env.CLINICA_WEBHOOK_SECRET = "test-secret-123";
    try {
      const noSecret = await POST(
        new Request("http://localhost:3000/api/integrations/clinica/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: EventType.CLINIC_STAFF_LOGIN, recepcion: "Mariana Soto", clinica: "CDMX Tlalpan" }),
        }),
      );
      expect(noSecret.status).toBe(401);

      const ok = await POST(
        new Request("http://localhost:3000/api/integrations/clinica/events", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-clinica-webhook-secret": "test-secret-123",
          },
          body: JSON.stringify({
            type: EventType.CLINIC_STAFF_LOGIN,
            idempotencyKey: "login-1",
            recepcion: "Mariana Soto",
            clinica: "CDMX Tlalpan",
          }),
        }),
      );
      expect(ok.status).toBe(201);
      const body = await ok.json();
      expect(body.ok).toBe(true);
      expect(body.duplicate).toBe(false);
      expect(body.events).toHaveLength(1);
      expect(body.events[0].channel).toBe("CLINICA");

      // Idempotencia
      const dup = await POST(
        new Request("http://localhost:3000/api/integrations/clinica/events", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-clinica-webhook-secret": "test-secret-123",
          },
          body: JSON.stringify({
            type: EventType.CLINIC_STAFF_LOGIN,
            idempotencyKey: "login-1",
            recepcion: "Mariana Soto",
            clinica: "CDMX Tlalpan",
          }),
        }),
      );
      expect(dup.status).toBe(200);
      expect((await dup.json()).duplicate).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CLINICA_WEBHOOK_SECRET;
      else process.env.CLINICA_WEBHOOK_SECRET = prev;
    }
  });

  it("Opción B: paciente solo en SWI guarda evento en vivo y auditoría sin crear espejo en Patient/Case", async () => {
    const received: Event[] = [];
    const listener = (e: Event) => received.push(e);
    bus.on("event", listener);
    try {
      const r = await ingestClinicEvent({
        type: EventType.CLINIC_PAYMENT_APPROVED,
        telefono: "5512345678",
        pacienteNombre: "Lucía Torres",
        folio: "SD-SWI999",
        estudio: "Biometría hemática",
        clinica: "Salud Digna CDMX Tlalpan",
        recepcion: "Mariana Soto",
        monto: 195,
        marca: "Visa",
        ultimos4: "4242",
        referencia: "REF-001",
      });

      expect(r.duplicate).toBe(false);
      expect(r.events).toHaveLength(1);
      expect(r.events[0].channel).toBe("CLINICA");
      expect(r.events[0].patientId).toBeNull();
      expect(r.events[0].caseId).toBeNull();
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe(EventType.CLINIC_PAYMENT_APPROVED);

      // Verifica que NO se crearon espejos locales
      expect(await db.patient.count()).toBe(0);
      expect(await db.case.count()).toBe(0);

      const o = await getOverview();
      expect(o.kpis.clinicEvents24h).toBe(1);
      expect(o.channels).toContain("CLINICA");
      expect(o.audit[0]).toMatchObject({
        type: EventType.CLINIC_PAYMENT_APPROVED,
        staff: { nombre: "Mariana Soto", role: "RECEPCION" },
        paciente: "Lucía Torres",
      });
    } finally {
      bus.off("event", listener);
    }
  });

  it("enlaza paciente/trámite existente por teléfono y registra transición WEB → CLINICA en tiempo real", async () => {
    const p = await db.patient.create({
      data: { nombre: "Ana López", telefono: "+526670000001", fechaNac: new Date("1992-04-15") },
    });
    const c = await createCase({ channel: "WEB", patientId: p.id });
    await advance({ caseId: c.id, to: "ESTUDIO_ELEGIDO", data: { studyId: "us" }, channel: "WEB", expectedVersion: 1 });

    const r = await ingestClinicEvent({
      type: EventType.CLINIC_CHECK_IN,
      telefono: "6670000001",
      estudio: "Ultrasonido abdominal",
      clinica: "Salud Digna Culiacán Centro",
      recepcion: "Mariana Soto",
    });

    expect(r.events.map((e) => e.type)).toEqual([EventType.CASE_RESUMED, EventType.CLINIC_CHECK_IN]);
    expect(r.events[1].patientId).toBe(p.id);
    expect(r.events[1].caseId).toBe(c.id);

    const o = await getOverview();
    expect(o.transitions).toEqual({ WEB: { CLINICA: 1 } });
    const j = o.journeys.find((x) => x.caseId === c.id)!;
    expect(j.channels).toEqual(["WEB", "CLINICA"]);
    expect(j.lastChannel).toBe("CLINICA");
  });
});
