import { describe, expect, it, vi } from "vitest";
import {
  SwiError,
  avanzarTramite,
  buildSwiUrl,
  enviarEncuesta,
  getContextoPaciente,
  guardarPreguntaSeguridad,
  pagarConTarjetaApp,
  registrarEventoRecepcion,
  registrarInteraccion,
  registrarPaciente,
  registrarPagoEnClinica,
  verificarPreguntaSeguridad,
  type FetchLike,
} from "./swi";

const BASE = "http://10.35.9.162:3000/api";
const KEY = "demo-canales-2026";

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("lib/server/swi.ts", () => {
  it("construye URLs sin duplicar /api", () => {
    expect(buildSwiUrl("/estudios", "http://10.35.9.162:3000")).toBe(
      "http://10.35.9.162:3000/api/estudios",
    );
    expect(buildSwiUrl("/estudios", "http://10.35.9.162:3000/api")).toBe(
      "http://10.35.9.162:3000/api/estudios",
    );
  });

  it("envía x-api-key y canal CLINICA por defecto, y registra contactoParentesco en POST /pacientes", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValueOnce(jsonResp({ paciente: { id: "p-1" } }, 201));

    await registrarPaciente(
      {
        telefono: "+52 667 000 0001",
        nombres: "Ana",
        primerApellido: "López",
        segundoApellido: "Ruiz",
        fechaNacimiento: "1992-04-15",
        sexo: "M",
        entidad: "SL",
        email: "ana@correo.com",
        telefonoFijo: "6671112233",
        contactoNombre: "Luis López",
        contactoTelefono: "6672223344",
        contactoParentesco: "PAREJA",
      },
      { baseUrl: BASE, apiKey: KEY, fetchImpl },
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE}/pacientes`);
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    const body = JSON.parse(String(init?.body));
    expect(body.canal).toBe("CLINICA");
    expect(body.telefono).toBe("6670000001");
    expect(body.contactoParentesco).toBe("PAREJA");
  });

  it("bloquea AGENDAR, pago en CLINICA y CHECK_IN cuando registroCompleto es false", async () => {
    const incompleteCtx = {
      paciente: {
        id: "p-1",
        telefono: "6670000001",
        registroCompleto: false,
        faltanDatos: ["correo", "teléfono fijo"],
      },
      tramiteActivo: null,
      tramites: [],
      interacciones: [],
      canalesUsados: [],
    };
    const fetchImpl = vi.fn<FetchLike>().mockImplementation(async () => jsonResp(incompleteCtx));

    await expect(
      avanzarTramite("tr-1", "AGENDAR", undefined, {
        telefonoParaValidar: "6670000001",
        baseUrl: BASE,
        apiKey: KEY,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Completa su registro para continuar: falta correo, teléfono fijo.",
    });

    await expect(
      registrarPagoEnClinica("tr-1", {
        telefonoParaValidar: "6670000001",
        baseUrl: BASE,
        apiKey: KEY,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Completa su registro para continuar: falta correo, teléfono fijo.",
    });

    await expect(
      registrarEventoRecepcion(
        {
          tramiteId: "tr-1",
          telefono: "6670000001",
          tipo: "CHECK_IN",
          recepcion: "María",
        },
        { baseUrl: BASE, apiKey: KEY, fetchImpl },
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "Completa su registro para continuar: falta correo, teléfono fijo.",
    });
  });

  it("envía canal APP únicamente en pago con tarjeta y canal CLINICA en pago en clínica", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResp({ pago: { estado: "APROBADO", monto: 450, referencia: "REF-1" } }))
      .mockResolvedValueOnce(jsonResp({ pago: { estado: "PENDIENTE", monto: 450, referencia: "REF-2" } }));

    await pagarConTarjetaApp(
      "tr-1",
      { numero: "4242 4242 4242 4242", titular: "Ana López", vencimiento: "12/30", cvc: "123" },
      { baseUrl: BASE, apiKey: KEY, fetchImpl },
    );
    await registrarPagoEnClinica("tr-1", { baseUrl: BASE, apiKey: KEY, fetchImpl });

    const cardBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(cardBody.canal).toBe("APP");
    expect(cardBody.metodo).toBe("TARJETA");
    expect(cardBody.tarjeta.numero).toBe("4242424242424242");

    const clinicBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
    expect(clinicBody.canal).toBe("CLINICA");
    expect(clinicBody.metodo).toBe("CLINICA");
  });

  it("usa ?registrar=1&canal=CLINICA para CONTEXTO_CONSULTADO y valida tipos exactos en interacciones", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResp({ paciente: { id: "p-1" }, tramites: [], interacciones: [], canalesUsados: [] }))
      .mockResolvedValueOnce(jsonResp({ ok: true }, 201));

    await getContextoPaciente("6670000001", { registrar: true, baseUrl: BASE, apiKey: KEY, fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/pacientes/6670000001/contexto?registrar=1&canal=CLINICA`);

    await registrarInteraccion(
      { tramiteId: "tr-1", tipo: "CITA_VISUALIZADA", detalle: { folio: "SD-123" } },
      { baseUrl: BASE, apiKey: KEY, fetchImpl },
    );
    const evBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
    expect(evBody).toEqual({
      canal: "CLINICA",
      tramiteId: "tr-1",
      tipo: "CITA_VISUALIZADA",
      detalle: { folio: "SD-123" },
    });

    await expect(
      registrarInteraccion(
        {
          telefono: "6670000001",
          // @ts-expect-error probando tipo inválido en tiempo de ejecución
          tipo: "TIPO_INVENTADO",
          detalle: {},
        },
        { baseUrl: BASE, apiKey: KEY, fetchImpl },
      ),
    ).rejects.toBeInstanceOf(SwiError);
  });

  it("maneja pregunta de seguridad (PUT/POST + 429) y encuesta con motivo obligatorio < 3", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResp({ ok: true }))
      .mockResolvedValueOnce(jsonResp({ error: "Demasiados intentos. Espera 15 minutos." }, 429))
      .mockResolvedValueOnce(jsonResp({ ok: true }, 201));

    await guardarPreguntaSeguridad("6670000001", "¿Mascota?", "Firulais", {
      baseUrl: BASE,
      apiKey: KEY,
      fetchImpl,
    });
    expect(fetchImpl.mock.calls[0][1]?.method).toBe("PUT");

    await expect(
      verificarPreguntaSeguridad("6670000001", "mal", { baseUrl: BASE, apiKey: KEY, fetchImpl }),
    ).rejects.toMatchObject({
      status: 429,
      message: "Demasiados intentos. Espera 15 minutos.",
    });

    await expect(
      enviarEncuesta({ telefono: "6670000001", puntaje: 2 }, { baseUrl: BASE, apiKey: KEY, fetchImpl }),
    ).rejects.toMatchObject({ status: 400 });

    await enviarEncuesta(
      { telefono: "6670000001", puntaje: 2, motivo: "Tiempo de espera" },
      { baseUrl: BASE, apiKey: KEY, fetchImpl },
    );
    const surveyBody = JSON.parse(String(fetchImpl.mock.calls[2][1]?.body));
    expect(surveyBody).toEqual({
      canal: "CLINICA",
      telefono: "6670000001",
      puntaje: 2,
      motivo: "Tiempo de espera",
    });
  });
});
