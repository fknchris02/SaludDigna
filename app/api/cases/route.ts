import { z } from "zod";
import { createCase, getActiveCase } from "@/lib/engine/case";
import { ChannelSchema, handleError } from "@/lib/http";

// shortcut: sin autenticación todavía; el patientId/anonIdentityId debe salir de la sesión, no del body.

const CreateBody = z.object({
  channel: ChannelSchema,
  patientId: z.string().optional(),
  anonIdentityId: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const c = await createCase(CreateBody.parse(await req.json()));
    return Response.json(c, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

/** GET /api/cases?patientId=… → trámite abierto que el canal debe ofrecer retomar (o null). */
export async function GET(req: Request) {
  try {
    const patientId = z.string().min(1).parse(new URL(req.url).searchParams.get("patientId"));
    return Response.json(await getActiveCase(patientId));
  } catch (err) {
    return handleError(err);
  }
}
