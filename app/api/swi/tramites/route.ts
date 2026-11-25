import { z } from "zod";
import { crearTramite } from "@/lib/server/swi";
import { handleSwiError } from "@/lib/server/swiHttp";

const CrearTramiteSchema = z.object({
  telefono: z.string().trim().min(10, "Teléfono inválido"),
  estudioId: z.string().trim().min(1, "Elige un estudio"),
  canal: z.enum(["WEB", "APP", "WHATSAPP", "CALL_CENTER", "CLINICA"]).optional(),
});

/** POST /api/swi/tramites → crea un trámite en SWI (SWI registra COTIZACION_INICIADA + ESTUDIO_SELECCIONADO). */
export async function POST(req: Request) {
  try {
    const body = CrearTramiteSchema.parse(await req.json());
    const tramite = await crearTramite(body.telefono, body.estudioId, { canal: body.canal });
    return Response.json({ tramite }, { status: 201 });
  } catch (err) {
    return handleSwiError(err);
  }
}
