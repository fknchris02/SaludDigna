import { describe, expect, it, vi } from "vitest";
import { splitContextoTramites, viewForTramite, wizardIndexFor } from "../bookingState";
import {
  enmascararTelefono,
  formatearTelefono,
  normalizarTelefono,
} from "../constantes";
import { generarCurp, leerCurp, validarCurp } from "../curp";
import { ago, formatMoney } from "../format";
import { espaciosDisponibles } from "../horarios";
import { SwiError, buildSwiUrl, swiRequest, type FetchLike } from "../swiApi";
import { detectarMarca, formatearNumero, luhn, validarTarjeta } from "../tarjetas";
import type { Contexto, Tramite } from "../../types/swi";

function mockTramite(overrides: Partial<Tramite> = {}): Tramite {
  return {
    id: "tr-1",
    folio: "SD-ABC123",
    estado: "COTIZANDO",
    paso: "CLINICA",
    estudio: { id: "est-1", nombre: "Ultrasonido abdominal", precio: 450, preparacion: "Ayuno 8 h" },
    clinica: null,
    fechaCita: null,
    canalOrigen: "WEB",
    canalActual: "WEB",
    creadoEn: "2026-11-24T12:00:00Z",
    actualizadoEn: "2026-11-24T12:05:00Z",
    abandonadoEn: null,
    recuperadoPor: null,
    pago: { estado: "PENDIENTE", detalle: null, ultimoRechazo: null, intentosRechazados: 0 },
    ...overrides,
  };
}

describe("constantes y teléfonos mexicanos", () => {
  it("normaliza formatos con +52, 521 y espacios a 10 dígitos", () => {
    expect(normalizarTelefono("667 000 0001")).toBe("6670000001");
    expect(normalizarTelefono("+52 667-000-0001")).toBe("6670000001");
    expect(normalizarTelefono("5216670000001")).toBe("6670000001");
    expect(normalizarTelefono("12345")).toBeNull();
  });

  it("formatea y enmascara correctamente", () => {
    expect(formatearTelefono("6670000001")).toBe("667 000 0001");
    expect(enmascararTelefono("6670000001")).toBe("+52******0001");
  });
});

describe("CURP (generación, validación y lectura)", () => {
  it("genera, valida y extrae datos de la CURP demo de SWI", () => {
    const gen = generarCurp({
      nombres: "Ana",
      primerApellido: "López",
      segundoApellido: "García",
      fechaNacimiento: "1994-03-15",
      sexo: "M",
      entidad: "SL",
    });
    expect(gen).not.toBeNull();
    expect(validarCurp(gen!.curp).valida).toBe(true);
    expect(leerCurp(gen!.curp)).toEqual({
      fechaNacimiento: "1994-03-15",
      sexo: "M",
      entidad: "SL",
    });
  });

  it("rechaza CURP con dígito verificador incorrecto", () => {
    expect(validarCurp("LOGA940315MSLPRN00").valida).toBe(false);
  });
});

describe("tarjetas de prueba SWI / Stripe", () => {
  it("detecta marcas, aplica Luhn y valida vencimiento/CVC", () => {
    expect(detectarMarca("4242424242424242")).toBe("visa");
    expect(detectarMarca("5555555555554444")).toBe("mastercard");
    expect(detectarMarca("378282246310005")).toBe("amex");
    expect(luhn("4242424242424242")).toBe(true);
    expect(formatearNumero("4242424242424242")).toBe("4242 4242 4242 4242");

    const ok = validarTarjeta(
      {
        numero: "4242424242424242",
        titular: "Ana López",
        vencimiento: "12/30",
        cvc: "123",
      },
      new Date("2026-11-24T12:00:00Z"),
    );
    expect(Object.keys(ok)).toHaveLength(0);

    const vencida = validarTarjeta(
      {
        numero: "4242424242424242",
        titular: "Ana López",
        vencimiento: "01/20",
        cvc: "12",
      },
      new Date("2026-11-24T12:00:00Z"),
    );
    expect(vencida.vencimiento).toBeTruthy();
    expect(vencida.cvc).toBeTruthy();
  });
});

describe("horarios de clínica", () => {
  it("genera espacios cada 30 min respetando días cerrados y anticipación", () => {
    const horarios = {
      "0": null,
      "1": ["08:00", "10:00"] as [string, string],
      "2": ["08:00", "10:00"] as [string, string],
      "3": ["08:00", "10:00"] as [string, string],
      "4": ["08:00", "10:00"] as [string, string],
      "5": ["08:00", "10:00"] as [string, string],
      "6": null,
    };
    const dias = espaciosDisponibles(horarios, 3, new Date("2026-11-23T12:00:00Z"), 60);
    expect(dias.length).toBe(3);
    expect(dias[0].horas).toEqual(["08:00", "08:30", "09:00", "09:30"]);
    expect(dias.every((d) => d.diaSemana !== 0 && d.diaSemana !== 6)).toBe(true);
  });
});

describe("cliente SWI (http://10.35.9.162:3000)", () => {
  it("arma URL con /api y canal=APP apuntando por defecto a 10.35.9.162:3000", () => {
    expect(buildSwiUrl("/estudios")).toBe("http://10.35.9.162:3000/api/estudios?canal=APP");
    expect(buildSwiUrl("/pacientes/6670000001/contexto?registrar=1")).toBe(
      "http://10.35.9.162:3000/api/pacientes/6670000001/contexto?registrar=1&canal=APP",
    );
  });

  it("envía x-api-key y canal APP en POST y propaga SwiError en respuestas de error", async () => {
    const mockFetch = vi.fn<FetchLike>().mockResolvedValueOnce(
      new Response(JSON.stringify({ tramite: { id: "tr-9" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await swiRequest<{ tramite: { id: string } }>("/tramites", {
      method: "POST",
      body: { telefono: "6670000001", estudioId: "est-1" },
      apiKey: "demo-canales-2026",
      fetchImpl: mockFetch,
    });

    expect(res.tramite.id).toBe("tr-9");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://10.35.9.162:3000/api/tramites?canal=APP");
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("demo-canales-2026");
    expect(JSON.parse(String(init?.body))).toEqual({
      canal: "APP",
      telefono: "6670000001",
      estudioId: "est-1",
    });

    const mock404 = vi.fn<FetchLike>().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Paciente no encontrado" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      swiRequest("/pacientes/6670000009/contexto", { fetchImpl: mock404 }),
    ).rejects.toMatchObject({
      name: "SwiError",
      status: 404,
      message: "Paciente no encontrado",
    });
  });

  it("envuelve fallas de red en SwiError con status 0", async () => {
    const mockFail = vi.fn<FetchLike>().mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(swiRequest("/estudios", { fetchImpl: mockFail })).rejects.toBeInstanceOf(
      SwiError,
    );
  });
});

describe("máquina de vistas y clasificación de trámites", () => {
  it("determina la vista correcta según avance del trámite en SWI", () => {
    expect(viewForTramite(null, { datosCompletos: true })).toBe("ESTUDIO");
    expect(viewForTramite(mockTramite(), { datosCompletos: true })).toBe("CLINICA");
    expect(
      viewForTramite(
        mockTramite({
          estado: "CLINICA_SELECCIONADA",
          clinica: { id: "cl-1", nombre: "Culiacán", ciudad: "Culiacán", direccion: "Centro" },
        }),
        { datosCompletos: true },
      ),
    ).toBe("HORARIO");
    expect(
      viewForTramite(
        mockTramite({
          estado: "CLINICA_SELECCIONADA",
          clinica: { id: "cl-1", nombre: "Culiacán", ciudad: "Culiacán", direccion: "Centro" },
          fechaCita: "2026-11-26T16:00:00Z",
        }),
        { datosCompletos: true },
      ),
    ).toBe("DATOS");
    expect(
      viewForTramite(
        mockTramite({
          estado: "DATOS_CAPTURADOS",
          paso: "CONFIRMAR",
          clinica: { id: "cl-1", nombre: "Culiacán", ciudad: "Culiacán", direccion: "Centro" },
          fechaCita: "2026-11-26T16:00:00Z",
        }),
        { datosCompletos: true },
      ),
    ).toBe("CITA");
    expect(
      viewForTramite(
        mockTramite({
          estado: "DATOS_CAPTURADOS",
          paso: "CONFIRMAR",
          clinica: { id: "cl-1", nombre: "Culiacán", ciudad: "Culiacán", direccion: "Centro" },
          fechaCita: "2026-11-26T16:00:00Z",
        }),
        { datosCompletos: false },
      ),
    ).toBe("DATOS");
    expect(viewForTramite(mockTramite({ estado: "CONFIRMADO" }), { datosCompletos: true })).toBe(
      "LISTO",
    );
    expect(wizardIndexFor("ESTUDIO")).toBe(1);
    expect(wizardIndexFor("CITA")).toBe(4);
  });

  it("separa trámite en curso, próximas citas e historial", () => {
    const activo = mockTramite({ id: "t-open", estado: "ABANDONADO" });
    const proxima = mockTramite({
      id: "t-up",
      estado: "CONFIRMADO",
      fechaCita: "2026-11-28T16:00:00Z",
    });
    const cancelada = mockTramite({
      id: "t-can",
      estado: "CANCELADO",
      fechaCita: "2026-11-28T18:00:00Z",
    });
    const pasada = mockTramite({
      id: "t-old",
      estado: "CONFIRMADO",
      fechaCita: "2026-11-10T16:00:00Z",
    });

    const ctx: Contexto = {
      paciente: {
        id: "p-1",
        nombre: "Ana López",
        nombres: "Ana",
        primerApellido: "López",
        segundoApellido: "Ruiz",
        telefono: "6670000001",
        email: "ana@test.mx",
        fechaNacimiento: "1992-04-15",
        sexo: "M",
        entidadNacimiento: "SL",
        curp: null,
        telefonoFijo: "6671111111",
        contactoNombre: "Luis",
        contactoTelefono: "6672222222",
        datosCompletos: true,
      },
      tramiteActivo: activo,
      tramites: [activo, proxima, cancelada, pasada],
      interacciones: [],
      canalesUsados: ["WEB", "APP"],
    };

    const split = splitContextoTramites(ctx, new Date("2026-11-24T18:00:00Z"));
    expect(split.active?.id).toBe("t-open");
    expect(split.upcoming.map((t) => t.id)).toEqual(["t-up"]);
    expect(split.history.map((t) => t.id).sort()).toEqual(["t-can", "t-old"]);
  });

  it("formatea moneda y tiempo transcurrido", () => {
    expect(formatMoney(450)).toContain("450");
    expect(ago("2026-11-24T12:00:00Z", new Date("2026-11-24T12:05:00Z").getTime())).toBe(
      "hace 5 min",
    );
  });
});
