import { z } from "zod";
import { assertStaffCanSee, requireStaff } from "@/lib/auth/session";
import { captureProspectData } from "@/lib/engine/identity";
import { handleError } from "@/lib/http";

const Body = z.object({ nombre: z.string().trim().min(3).max(120), fechaNac: z.iso.date() });

/** El asesor captura nombre y fecha de nacimiento de un prospecto que ya validó (solo si no los tenía). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff(req);
    const { id } = await params;
    await assertStaffCanSee(staff, id);
    await captureProspectData(staff.staffId, id, Body.parse(await req.json()));
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
