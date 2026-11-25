import { z } from "zod";
import { enviarEncuesta } from "@/lib/server/swi";
import { handleSwiError } from "@/lib/server/swiHttp";

const EncuestaSchema = z
  .object({
    telefono: z.string().trim().min(10, "Teléfono inválido"),
    puntaje: z.number().int().min(1).max(5),
    motivo: z.string().trim().max(500).optional(),
    tramiteId: z.string().trim().min(1).optional(),
    canal: z.enum(["WEB", "APP", "WHATSAPP", "CALL_CENTER", "CLINICA"]).optional(),
  })
  .refine((v) => v.puntaje >= 3 || Boolean(v.motivo && v.motivo.trim().length > 0), {
    message: "El motivo es obligatorio cuando el puntaje es menor a 3.",
    path: ["motivo"],
  });

/** POST /api/swi/encuestas → registra encuesta de satisfacción (1-5) en SWI. */
export async function POST(req: Request) {
  try {
    const body = EncuestaSchema.parse(await req.json());
    const result = await enviarEncuesta(body);
    return Response.json({ ok: true, result }, { status: 201 });
  } catch (err) {
    return handleSwiError(err);
  }
}
