import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { EngineError } from "@/lib/engine/case";
import { isVerifiedByStaff, verifyByStaff } from "@/lib/engine/identity";
import { handleError } from "@/lib/http";

const Body = z.object({ fechaNac: z.iso.date(), last4: z.string().regex(/^\d{4}$/) });

/** El asesor valida 2 datos que le dicta el paciente. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff(req);
    const { id } = await params;
    if (!(await verifyByStaff(staff.staffId, id, Body.parse(await req.json())))) {
      throw new EngineError("IDENTITY_REQUIRED", "Los datos no coinciden");
    }
    return Response.json({ verifiedUntil: await isVerifiedByStaff(staff.staffId, id) });
  } catch (err) {
    return handleError(err);
  }
}
