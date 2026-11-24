import { z } from "zod";
import { clearSession } from "@/lib/auth/session";
import { handleError } from "@/lib/http";

export async function POST(req: Request) {
  try {
    const { scope } = z.object({ scope: z.enum(["WEB", "APP", "STAFF"]) }).parse(await req.json());
    await clearSession(scope);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleError(err);
  }
}
