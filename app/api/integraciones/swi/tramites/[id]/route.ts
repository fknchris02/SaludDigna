import { requireStaff } from "@/lib/auth/session";
import { EngineError } from "@/lib/engine/case";
import { recordStaffAccess } from "@/lib/engine/events";
import { handleError } from "@/lib/http";
import { getSwiJourney } from "@/lib/integrations/swi-overview";

/** Un trámite de SWI con su línea de tiempo, para el mapa del recorrido en el tablero del admin. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff(req, ["ADMIN"]);
    const { id } = await params;
    const j = await getSwiJourney(id);
    if (!j) throw new EngineError("NOT_FOUND", "Trámite de SWI no encontrado");
    await recordStaffAccess(staff.staffId, staff.role, j.patientId, null); // la consulta queda en la auditoría
    return Response.json(j.detail);
  } catch (err) {
    return handleError(err);
  }
}
