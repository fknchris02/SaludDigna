import { db } from "@/lib/db";
import { slots } from "@/lib/format";
import { handleError } from "@/lib/http";

/** Catálogo público: estudios, clínicas y horarios disponibles. */
export async function GET() {
  try {
    const [studies, clinics] = await Promise.all([
      db.study.findMany({ orderBy: { nombre: "asc" } }),
      db.clinic.findMany({ orderBy: { nombre: "asc" } }),
    ]);
    return Response.json({ studies, clinics, slots: slots() });
  } catch (err) {
    return handleError(err);
  }
}
