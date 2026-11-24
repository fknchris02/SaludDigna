import { z } from "zod";
import { ensurePatientSession, setSession } from "@/lib/auth/session";
import { getActiveCase } from "@/lib/engine/case";
import { verifyAndLink } from "@/lib/engine/identity";
import { handleError } from "@/lib/http";

const Body = z.object({
  telefono: z.string().min(8).max(25),
  code: z.string().regex(/^\d{6}$/),
  channel: z.enum(["WEB", "APP"]),
  perfil: z.object({ nombre: z.string().trim().min(2).max(120), fechaNac: z.iso.date() }).optional(),
});

/** Verifica el OTP, liga la identidad del canal al paciente y deja la sesión ya identificada. */
export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const session = await ensurePatientSession(body.channel);
    const patient = await verifyAndLink({ identityId: session.identityId, telefono: body.telefono, code: body.code, perfil: body.perfil });
    await setSession(body.channel, { ...session, patientId: patient.id });
    return Response.json({ patient: { id: patient.id, nombre: patient.nombre }, activeCase: await getActiveCase(patient.id) });
  } catch (err) {
    return handleError(err);
  }
}
