import { z } from "zod";
import { ensurePatientSession } from "@/lib/auth/session";
import { maskPhone, requestOtp } from "@/lib/engine/identity";
import { handleError } from "@/lib/http";

const Body = z.object({ telefono: z.string().min(8).max(25), channel: z.enum(["WEB", "APP"]) });

export async function POST(req: Request) {
  try {
    const { telefono, channel } = Body.parse(await req.json());
    await ensurePatientSession(channel);
    const otp = await requestOtp(telefono, channel);
    // shortcut: demoCode existe porque no hay proveedor SMS; quitarlo al integrar SMS/WhatsApp.
    return Response.json({ telefono: maskPhone(otp.telefono), demoCode: otp.code });
  } catch (err) {
    return handleError(err);
  }
}
