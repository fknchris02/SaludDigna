import { requireStaff } from "@/lib/auth/session";
import { searchPatients } from "@/lib/engine/identity";
import { handleError } from "@/lib/http";

/** GET /api/staff/patients?q=… → coincidencias enmascaradas (sin validar todavía). */
export async function GET(req: Request) {
  try {
    await requireStaff(req);
    const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
    return Response.json({ results: await searchPatients(q) });
  } catch (err) {
    return handleError(err);
  }
}
