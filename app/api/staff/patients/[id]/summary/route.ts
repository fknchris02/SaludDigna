import { summarizeWithAI } from "@/lib/ai/summary";
import { assertStaffCanSee, requireStaff } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getActiveCase } from "@/lib/engine/case";
import { handleError } from "@/lib/http";

/** Resumen con IA del expediente (aparte del expediente para no frenar la consola mientras el LLM responde). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff(req);
    const { id } = await params;
    await assertStaffCanSee(staff, id);
    const [events, active] = await Promise.all([
      db.event.findMany({ where: { patientId: id }, orderBy: { seq: "desc" }, take: 200 }).then((e) => e.reverse()),
      getActiveCase(id),
    ]);
    return Response.json(await summarizeWithAI(events, active));
  } catch (err) {
    return handleError(err);
  }
}
