import { z } from "zod";
import { guardarPreguntaSeguridad, verificarPreguntaSeguridad } from "@/lib/server/swi";
import { handleSwiError } from "@/lib/server/swiHttp";

type Ctx = { params: Promise<{ telefono: string }> };

const PutSchema = z.object({
  pregunta: z.string().trim().min(3, "Escribe la pregunta de seguridad."),
  respuesta: z.string().trim().min(1, "Escribe la respuesta de seguridad."),
  canal: z.enum(["WEB", "APP", "WHATSAPP", "CALL_CENTER", "CLINICA"]).optional(),
});

const PostSchema = z.object({
  respuesta: z.string().trim().min(1, "Escribe la respuesta de seguridad."),
  canal: z.enum(["WEB", "APP", "WHATSAPP", "CALL_CENTER", "CLINICA"]).optional(),
});

/** PUT /api/swi/pacientes/[telefono]/seguridad → registra pregunta y respuesta cifrada en SWI. */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { telefono } = await params;
    const body = PutSchema.parse(await req.json());
    const result = await guardarPreguntaSeguridad(telefono, body.pregunta, body.respuesta, {
      canal: body.canal,
    });
    return Response.json(result);
  } catch (err) {
    return handleSwiError(err);
  }
}

/** POST /api/swi/pacientes/[telefono]/seguridad → verifica respuesta ({ correcta, intentosRestantes } o 429). */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { telefono } = await params;
    const body = PostSchema.parse(await req.json());
    const result = await verificarPreguntaSeguridad(telefono, body.respuesta, {
      canal: body.canal,
    });
    return Response.json(result);
  } catch (err) {
    return handleSwiError(err);
  }
}
