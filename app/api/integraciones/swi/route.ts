import { z } from "zod";
import { ingestSwi, SWI_MAX_REGISTROS, validSwiKey } from "@/lib/integrations/swi";

const Body = z.object({ registros: z.array(z.unknown()).min(1).max(SWI_MAX_REGISTROS) });
const MAX_BYTES = 1_000_000;

/** Recibe lotes de la app SWI en su propio formato. Autenticación: encabezado x-api-key = SWI_API_KEY. */
export async function POST(req: Request) {
  if (!validSwiKey(req.headers.get("x-api-key"))) return Response.json({ error: "x-api-key inválida o faltante" }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return Response.json({ error: "Lote demasiado grande (máx. 1 MB)" }, { status: 413 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ error: `Se espera JSON { "registros": [ … ] } con 1 a ${SWI_MAX_REGISTROS} registros` }, { status: 400 });
  }
  const result = await ingestSwi(body.registros);
  // Para revisar después por qué SWI recibió errores (sin datos personales: solo id y motivo).
  if (result.errores.length) console.warn(`swi: ${result.errores.length} con error`, JSON.stringify(result.errores));
  return Response.json(result);
}
