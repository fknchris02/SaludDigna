import { requireStaff } from "@/lib/auth/session";
import { handleError } from "@/lib/http";
import { getSwiOverview } from "@/lib/integrations/swi-overview";

/** Para el tablero del admin: los trámites recibidos de SWI como recorridos (indicadores, etapas, cambios de canal). */
export async function GET(req: Request) {
  try {
    await requireStaff(req, ["ADMIN"]);
    return Response.json(await getSwiOverview());
  } catch (err) {
    return handleError(err);
  }
}
