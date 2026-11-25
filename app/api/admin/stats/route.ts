import { getAdminStats } from "@/lib/admin-stats";
import { requireStaff } from "@/lib/auth/session";
import { handleError } from "@/lib/http";

/** Dashboard del administrador: comparación con ayer, conversión, recuperación, clínicas, personal, bot y SWI. */
export async function GET(req: Request) {
  try {
    await requireStaff(req, ["ADMIN"]);
    return Response.json(await getAdminStats());
  } catch (err) {
    return handleError(err);
  }
}
