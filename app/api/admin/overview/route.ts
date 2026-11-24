import { requireStaff } from "@/lib/auth/session";
import { getOverview } from "@/lib/engine/overview";
import { handleError } from "@/lib/http";

/** Tablero del administrador: KPIs, etapas, cambios de canal, recorridos, auditoría y actividad reciente. */
export async function GET(req: Request) {
  try {
    await requireStaff(req, ["ADMIN"]);
    return Response.json(await getOverview());
  } catch (err) {
    return handleError(err);
  }
}
