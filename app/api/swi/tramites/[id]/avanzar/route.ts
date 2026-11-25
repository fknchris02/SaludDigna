import { z } from "zod";
import { avanzarTramite } from "@/lib/server/swi";
import { handleSwiError } from "@/lib/server/swiHttp";

type Ctx = { params: Promise<{ id: string }> };

const AvanzarSchema = z.object({
  accion: z.enum(["ESTUDIO", "CLINICA", "FECHA", "DATOS", "AGENDAR", "CONFIRMAR", "CANCELAR", "RETOMAR"]),
  datos: z.record(z.string(), z.unknown()).optional(),
  canal: z.enum(["WEB", "APP", "WHATSAPP", "CALL_CENTER", "CLINICA"]).optional(),
  telefonoParaValidar: z.string().trim().optional(),
});

/**
 * POST /api/swi/tramites/[id]/avanzar
 * Avanza paso a paso (`CLINICA` → `FECHA` → `AGENDAR` → `CONFIRMAR`).
 * Para `AGENDAR` y `CONFIRMAR`, valida `registroCompleto` antes si se proporciona `telefonoParaValidar`.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = AvanzarSchema.parse(await req.json());
    const tramite = await avanzarTramite(id, body.accion, body.datos, {
      canal: body.canal,
      telefonoParaValidar: body.telefonoParaValidar,
    });
    return Response.json({ tramite });
  } catch (err) {
    return handleSwiError(err);
  }
}
