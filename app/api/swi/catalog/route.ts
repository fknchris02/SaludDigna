import { getClinicas, getEstudios } from "@/lib/server/swi";
import { handleSwiError } from "@/lib/server/swiHttp";

/** GET /api/swi/catalog → estudios y clínicas en tiempo real desde SWI. */
export async function GET() {
  try {
    const [estudios, clinicas] = await Promise.all([getEstudios(), getClinicas()]);
    return Response.json({ estudios, clinicas });
  } catch (err) {
    return handleSwiError(err);
  }
}
