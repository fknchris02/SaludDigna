import { z } from "zod";
import { buscarPacientePorTelefono, registrarPaciente } from "@/lib/server/swi";
import { handleSwiError } from "@/lib/server/swiHttp";
import { CONTACTO_PARENTESCOS } from "@/lib/swi/types";

const RegistroPacienteSchema = z.object({
  telefono: z.string().trim().min(10, "Teléfono celular inválido"),
  nombres: z.string().trim().min(1, "Falta nombre(s)"),
  primerApellido: z.string().trim().min(1, "Falta primer apellido"),
  segundoApellido: z.string().trim().min(1, "Falta segundo apellido"),
  fechaNacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de nacimiento debe ser YYYY-MM-DD"),
  sexo: z.enum(["H", "M"]),
  entidad: z.string().trim().length(2, "Estado de nacimiento debe ser código de 2 letras"),
  curp: z.string().trim().optional(),
  email: z.string().trim().email("Correo inválido"),
  telefonoFijo: z.string().trim().min(10, "Teléfono fijo inválido"),
  contactoNombre: z.string().trim().min(1, "Falta nombre del familiar"),
  contactoTelefono: z.string().trim().min(10, "Teléfono del familiar inválido"),
  contactoParentesco: z.enum(CONTACTO_PARENTESCOS, {
    message: "Selecciona el parentesco del familiar",
  }),
  canal: z.enum(["WEB", "APP", "WHATSAPP", "CALL_CENTER", "CLINICA"]).optional(),
});

/** GET /api/swi/pacientes?telefono=... → busca paciente en SWI por teléfono. */
export async function GET(req: Request) {
  try {
    const telefono = (new URL(req.url).searchParams.get("telefono") ?? "").trim();
    if (!telefono) {
      return Response.json({ error: "Indica el teléfono a buscar." }, { status: 400 });
    }
    const result = await buscarPacientePorTelefono(telefono);
    return Response.json(result);
  } catch (err) {
    return handleSwiError(err);
  }
}

/** POST /api/swi/pacientes → registra o actualiza paciente en SWI con todos los campos obligatorios. */
export async function POST(req: Request) {
  try {
    const body = RegistroPacienteSchema.parse(await req.json());
    const result = await registrarPaciente(body);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return handleSwiError(err);
  }
}
