import { z } from "zod";
import { setSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EngineError } from "@/lib/engine/case";
import { handleError } from "@/lib/http";
import { verifyPassword } from "@/lib/password";

const Body = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) });

// shortcut: sin límite de intentos de login; agregar rate limit por IP/email antes de producción.
export async function POST(req: Request) {
  try {
    const { email, password } = Body.parse(await req.json());
    const staff = await db.staffUser.findUnique({ where: { email: email.toLowerCase() } });
    if (!staff || !verifyPassword(password, staff.passwordHash)) throw new EngineError("UNAUTHENTICATED", "Correo o contraseña incorrectos");
    await setSession("STAFF", { kind: "staff", staffId: staff.id, role: staff.role, nombre: staff.nombre });
    return Response.json({ nombre: staff.nombre, role: staff.role });
  } catch (err) {
    return handleError(err);
  }
}
