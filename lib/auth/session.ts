import { randomBytes } from "node:crypto";
import type { StaffRole } from "@prisma/client";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { z } from "zod";
import { EngineError } from "@/lib/engine/case";
import { getOrCreateChannelIdentity, isVerifiedByStaff } from "@/lib/engine/identity";

// Una cookie por canal: en la demo Web, App y consola del asesor conviven en el mismo navegador.
export type Scope = "WEB" | "APP" | "STAFF";
const COOKIE: Record<Scope, string> = { WEB: "sd_web", APP: "sd_app", STAFF: "sd_staff" };
const TTL_SECONDS: Record<Scope, number> = { WEB: 30 * 86400, APP: 7 * 86400, STAFF: 8 * 3600 };

const PatientSession = z.object({
  kind: z.literal("patient"),
  identityId: z.string(),
  patientId: z.string().nullable(), // null = visitante aún no verificado
});
const StaffSession = z.object({
  kind: z.literal("staff"),
  staffId: z.string(),
  role: z.enum(["ASESOR", "ADMIN"]),
  nombre: z.string(),
});
export type PatientSession = z.infer<typeof PatientSession>;
export type StaffSession = z.infer<typeof StaffSession>;
type SessionFor<S extends Scope> = S extends "STAFF" ? StaffSession : PatientSession;

function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("Falta SESSION_SECRET (mínimo 16 caracteres)");
  return new TextEncoder().encode(s);
}

export async function setSession<S extends Scope>(scope: S, data: SessionFor<S>) {
  const token = await new SignJWT(data)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS[scope]}s`)
    .sign(key());
  (await cookies()).set(COOKIE[scope], token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS[scope],
  });
}

export async function getSession<S extends Scope>(scope: S): Promise<SessionFor<S> | null> {
  const token = (await cookies()).get(COOKIE[scope])?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    const schema = scope === "STAFF" ? StaffSession : PatientSession;
    const parsed = schema.safeParse(payload);
    return parsed.success ? (parsed.data as SessionFor<S>) : null;
  } catch {
    return null; // firma inválida o expirada = sin sesión
  }
}

export async function clearSession(scope: Scope) {
  (await cookies()).delete(COOKIE[scope]);
}

/** Sesión de paciente del canal; si no existe, crea un visitante anónimo (Web/App). */
export async function ensurePatientSession(scope: "WEB" | "APP"): Promise<PatientSession> {
  const current = await getSession(scope);
  if (current) return current;
  const identity = await getOrCreateChannelIdentity(scope, randomBytes(16).toString("hex"));
  const s: PatientSession = { kind: "patient", identityId: identity.id, patientId: null };
  await setSession(scope, s);
  return s;
}

export type Actor =
  | { channel: "WEB" | "APP"; session: PatientSession }
  | { channel: "CALL_CENTER"; session: StaffSession };

/**
 * Quién hace la petición. El cliente indica el canal (header `x-sd-channel` o `?as=`, porque EventSource
 * no manda headers) y eso solo elige QUÉ cookie leer: nadie puede usar una sesión que no tiene.
 */
export async function getActor(req: Request): Promise<Actor | null> {
  const as = req.headers.get("x-sd-channel") ?? new URL(req.url).searchParams.get("as");
  if (as === "WEB" || as === "APP") {
    const session = await getSession(as);
    return session ? { channel: as, session } : null;
  }
  if (as === "CALL_CENTER" || as === "STAFF") {
    const session = await getSession("STAFF");
    return session ? { channel: "CALL_CENTER", session } : null;
  }
  return null;
}

export async function requireActor(req: Request) {
  const actor = await getActor(req);
  if (!actor) throw new EngineError("UNAUTHENTICATED", "Inicia sesión");
  return actor;
}

export async function requireStaff(req: Request, roles: StaffRole[] = ["ASESOR", "ADMIN"]) {
  const actor = await requireActor(req);
  if (actor.channel !== "CALL_CENTER" || !roles.includes(actor.session.role)) throw new EngineError("FORBIDDEN", "Sin permiso");
  return actor.session;
}

/** Paciente: solo sus trámites (o los que hizo como anónimo con esta identidad). Personal: todos. */
export function canAccessCase(actor: Actor, c: { patientId: string | null; anonIdentityId: string | null }) {
  if (actor.channel === "CALL_CENTER") return true;
  const s = actor.session;
  return (!!s.patientId && c.patientId === s.patientId) || c.anonIdentityId === s.identityId;
}

/**
 * El asesor solo ve datos de un paciente que validó en la llamada (2 datos). El admin monitorea sin validar.
 * Trámites anónimos (sin paciente) no son visibles para el asesor.
 */
export async function assertStaffCanSee(s: StaffSession, patientId: string | null) {
  if (s.role === "ADMIN") return;
  if (!patientId || !(await isVerifiedByStaff(s.staffId, patientId))) {
    throw new EngineError("IDENTITY_REQUIRED", "Valida la identidad del paciente antes de ver su información");
  }
}
