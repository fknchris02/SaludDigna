export type Marca = "visa" | "mastercard" | "amex" | "desconocida";

export const ETIQUETA_MARCA: Record<Marca, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  desconocida: "Tarjeta",
};

export type CodigoRechazo =
  | "card_declined"
  | "insufficient_funds"
  | "lost_card"
  | "stolen_card"
  | "expired_card"
  | "incorrect_cvc"
  | "processing_error"
  | "authentication_required"
  | "test_mode_live_card";

export type TarjetaPrueba = {
  numero: string;
  marca: Marca;
  descripcion: string;
  rechazo?: CodigoRechazo;
};

/** Mismos números y resultados que el modo de prueba de Stripe y SWI. */
export const TARJETAS_PRUEBA: TarjetaPrueba[] = [
  { numero: "4242424242424242", marca: "visa", descripcion: "Visa · aprobada" },
  { numero: "4000004840008001", marca: "visa", descripcion: "Visa México · aprobada" },
  { numero: "5555555555554444", marca: "mastercard", descripcion: "Mastercard · aprobada" },
  { numero: "5200828282828210", marca: "mastercard", descripcion: "Mastercard débito · aprobada" },
  { numero: "378282246310005", marca: "amex", descripcion: "American Express · aprobada" },
  { numero: "4000000000000002", marca: "visa", descripcion: "Rechazo genérico", rechazo: "card_declined" },
  { numero: "4000000000009995", marca: "visa", descripcion: "Fondos insuficientes", rechazo: "insufficient_funds" },
  { numero: "4000000000009987", marca: "visa", descripcion: "Tarjeta extraviada", rechazo: "lost_card" },
  { numero: "4000000000009979", marca: "visa", descripcion: "Tarjeta robada", rechazo: "stolen_card" },
  { numero: "4000000000000069", marca: "visa", descripcion: "Tarjeta vencida", rechazo: "expired_card" },
  { numero: "4000000000000127", marca: "visa", descripcion: "CVC incorrecto", rechazo: "incorrect_cvc" },
  { numero: "4000000000000119", marca: "visa", descripcion: "Error de procesamiento", rechazo: "processing_error" },
  {
    numero: "4000002760003184",
    marca: "visa",
    descripcion: "Requiere 3D Secure",
    rechazo: "authentication_required",
  },
];

export const soloDigitos = (s: string) => (s || "").replace(/\D/g, "");

export function detectarMarca(numero: string): Marca {
  const n = soloDigitos(numero);
  if (/^4/.test(n)) return "visa";
  if (/^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d{2}|27[01]\d|2720)/.test(n)) return "mastercard";
  if (/^3[47]/.test(n)) return "amex";
  return "desconocida";
}

export function luhn(numero: string): boolean {
  const n = soloDigitos(numero);
  if (n.length < 12) return false;
  let suma = 0;
  let doble = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = Number(n[i]);
    if (doble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
    doble = !doble;
  }
  return suma % 10 === 0;
}

export function formatearNumero(numero: string): string {
  const n = soloDigitos(numero).slice(0, detectarMarca(numero) === "amex" ? 15 : 16);
  if (detectarMarca(n) === "amex") {
    return [n.slice(0, 4), n.slice(4, 10), n.slice(10, 15)].filter(Boolean).join(" ");
  }
  return n.replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function formatearVencimiento(valor: string): string {
  const d = soloDigitos(valor).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export type DatosTarjeta = {
  numero: string;
  titular: string;
  vencimiento: string;
  cvc: string;
};

export function validarTarjeta(
  t: DatosTarjeta,
  hoy = new Date(),
): Partial<Record<keyof DatosTarjeta, string>> {
  const errores: Partial<Record<keyof DatosTarjeta, string>> = {};
  const n = soloDigitos(t.numero);
  const marca = detectarMarca(n);
  const largo = marca === "amex" ? 15 : 16;
  if (n.length !== largo || !luhn(n)) errores.numero = "El número de tarjeta no es válido.";
  else if (marca === "desconocida") {
    errores.numero = "Solo se aceptan Visa, Mastercard y American Express.";
  }

  if (!t.titular.trim()) errores.titular = "Escribe el nombre como aparece en la tarjeta.";

  const m = /^(\d{2})\/(\d{2})$/.exec(t.vencimiento);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) {
    errores.vencimiento = "Usa el formato MM/AA.";
  } else {
    const fin = new Date(2000 + Number(m[2]), Number(m[1]), 1);
    if (fin <= hoy) errores.vencimiento = "La tarjeta está vencida.";
  }

  const cvc = soloDigitos(t.cvc);
  if (cvc.length !== (marca === "amex" ? 4 : 3)) {
    errores.cvc =
      marca === "amex" ? "El CVC de Amex tiene 4 dígitos." : "El CVC tiene 3 dígitos.";
  }
  return errores;
}
