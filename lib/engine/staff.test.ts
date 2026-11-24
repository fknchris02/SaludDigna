import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { summarizeJourney } from "@/lib/ai/summary";
import { assertStaffCanSee } from "@/lib/auth/session";
import { handleInboundMessage } from "@/lib/channels/whatsapp";
import { db } from "@/lib/db";
import { resetDb } from "@/test/db";
import { advance, createCase, EngineError, getActiveCase } from "./case";
import { recordStaffAccess } from "./events";
import { isVerifiedByStaff, maskName, searchPatients, verifyByStaff } from "./identity";

const asesor = { kind: "staff" as const, staffId: "staff-1", role: "ASESOR" as const, nombre: "Luis" };
const admin = { ...asesor, staffId: "staff-2", role: "ADMIN" as const };

async function ana() {
  return db.patient.create({ data: { nombre: "Ana López Ruiz", telefono: "+526670000001", fechaNac: new Date("1992-04-15") } });
}

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe("Call Center", () => {
  it("búsqueda por teléfono o nombre devuelve datos enmascarados", async () => {
    await ana();
    expect(maskName("Ana López Ruiz")).toBe("Ana L. R.");
    const [byPhone] = await searchPatients("0001");
    expect(byPhone).toMatchObject({ nombre: "Ana L. R.", telefono: "+52******0001", tramitePendiente: false });
    expect(await searchPatients("lópez")).toHaveLength(1);
    expect(await searchPatients("an")).toEqual([]); // muy corto: no se busca
  });

  it("el asesor no ve nada hasta validar 2 datos; el admin sí", async () => {
    const p = await ana();
    await expect(assertStaffCanSee(asesor, p.id)).rejects.toBeInstanceOf(EngineError);
    await expect(assertStaffCanSee(admin, p.id)).resolves.toBeUndefined();

    expect(await verifyByStaff(asesor.staffId, p.id, { fechaNac: "1992-04-15", last4: "9999" })).toBe(false);
    expect(await verifyByStaff(asesor.staffId, p.id, { fechaNac: "1992-04-15", last4: "0001" })).toBe(true);
    expect(await isVerifiedByStaff(asesor.staffId, p.id)).toBeInstanceOf(Date);
    await expect(assertStaffCanSee(asesor, p.id)).resolves.toBeUndefined();
    // La validación es por asesor: otro asesor tendría que validar de nuevo.
    expect(await isVerifiedByStaff("staff-3", p.id)).toBeNull();
  });

  it("bloquea tras 3 intentos fallidos", async () => {
    const p = await ana();
    for (let i = 0; i < 3; i++) await verifyByStaff(asesor.staffId, p.id, { fechaNac: "2000-01-01", last4: "0001" });
    await expect(verifyByStaff(asesor.staffId, p.id, { fechaNac: "1992-04-15", last4: "0001" })).rejects.toMatchObject({ code: "IDENTITY_REQUIRED" });
  });

  it("la auditoría de acceso no se duplica en recargas", async () => {
    const p = await ana();
    await recordStaffAccess(asesor.staffId, "ASESOR", p.id, null);
    await recordStaffAccess(asesor.staffId, "ASESOR", p.id, null);
    expect(await db.event.count({ where: { type: "ADVISOR_OPENED_CASE", patientId: p.id } })).toBe(1);
  });

  it("resumen: recorrido entre canales, qué falta y qué preguntó", async () => {
    const p = await ana();
    const c = await createCase({ channel: "WEB", patientId: p.id });
    await advance({ caseId: c.id, to: "ESTUDIO_ELEGIDO", data: { studyId: "us" }, channel: "WEB", expectedVersion: 1 });
    await advance({ caseId: c.id, to: "CLINICA_ELEGIDA", data: { clinicId: "c1" }, channel: "WEB", expectedVersion: 2 });
    await handleInboundMessage({ from: "6670000001", text: "hola", messageId: "a" });
    await handleInboundMessage({ from: "6670000001", text: "15/04/1992", messageId: "b" });
    await handleInboundMessage({ from: "6670000001", text: "¿necesito ayuno?", messageId: "c" });
    await handleInboundMessage({ from: "6670000001", text: "quiero hablar con un asesor", messageId: "d" });

    const events = await db.event.findMany({ where: { patientId: p.id }, orderBy: { seq: "asc" } });
    const { lines } = summarizeJourney(events, await getActiveCase(p.id));
    const text = lines.join("\n");
    expect(text).toMatch(/Recorrido: Web → WhatsApp\./);
    expect(text).toMatch(/Ultrasonido en Clínica Centro/);
    expect(text).toMatch(/Falta: elegir horario/);
    expect(text).toMatch(/Preguntó por: preparación del estudio/);
    expect(text).toMatch(/Pidió hablar con un asesor por WhatsApp/);
    expect(text).not.toMatch(/\.\./);
  });
});
