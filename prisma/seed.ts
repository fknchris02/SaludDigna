import { db } from "@/lib/db";
import { advance, createCase } from "@/lib/engine/case";
import { hashPassword } from "@/lib/password";

// Datos ficticios para la demo. Precios y direcciones NO son reales.
const STUDIES = [
  { id: "us-abdominal", nombre: "Ultrasonido abdominal", precio: 45000, preparacion: "Ayuno de 6 a 8 horas." },
  { id: "us-obstetrico", nombre: "Ultrasonido obstétrico", precio: 40000, preparacion: "Sin preparación especial." },
  { id: "lab-quimica", nombre: "Química sanguínea 6 elementos", precio: 19000, preparacion: "Ayuno de 8 horas." },
  { id: "rx-torax", nombre: "Rayos X de tórax", precio: 25000, preparacion: "Sin preparación especial." },
  { id: "mastografia", nombre: "Mastografía", precio: 50000, preparacion: "No usar desodorante ni talco el día del estudio." },
];

const CLINICS = [
  { id: "cln-centro", nombre: "Clínica Culiacán Centro", ciudad: "Culiacán", direccion: "Av. Ejemplo 100, Centro" },
  { id: "cln-quintas", nombre: "Clínica Culiacán Las Quintas", ciudad: "Culiacán", direccion: "Blvd. Demo 250, Las Quintas" },
  { id: "cln-mazatlan", nombre: "Clínica Mazatlán", ciudad: "Mazatlán", direccion: "Av. Prueba 45, Centro" },
];

function tomorrowAt(h: number, days = 1) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("No correr el seed en producción");

  // Limpia datos transaccionales (orden por llaves foráneas).
  await db.event.deleteMany();
  await db.case.deleteMany();
  await db.channelIdentity.deleteMany();
  await db.otpChallenge.deleteMany();
  await db.patient.deleteMany();
  await db.staffUser.deleteMany();

  for (const s of STUDIES) await db.study.upsert({ where: { id: s.id }, update: s, create: s });
  for (const c of CLINICS) await db.clinic.upsert({ where: { id: c.id }, update: c, create: c });

  await db.staffUser.createMany({
    data: [
      { email: "asesor@demo.mx", nombre: "Luis Asesor", role: "ASESOR", passwordHash: hashPassword("asesor123") },
      { email: "admin@demo.mx", nombre: "Marta Admin", role: "ADMIN", passwordHash: hashPassword("admin123") },
    ],
  });

  // Ana: protagonista de la demo; empieza SIN trámites (se crean en vivo desde la web).
  await db.patient.create({
    data: { nombre: "Ana López", telefono: "+526670000001", fechaNac: new Date("1992-04-15"), email: "ana@demo.mx" },
  });

  // Otros pacientes con trámites en distintos pasos para que el tablero admin no arranque vacío.
  const others = [
    { nombre: "Carlos Ruiz", telefono: "+526670000002", fechaNac: "1985-09-02", hasta: 2, canal: "WHATSAPP" as const },
    { nombre: "Sofía Medina", telefono: "+526670000003", fechaNac: "1999-01-20", hasta: 5, canal: "WEB" as const },
    { nombre: "Jorge Pérez", telefono: "+526670000004", fechaNac: "1978-06-11", hasta: 3, canal: "CALL_CENTER" as const },
  ];
  for (const o of others) {
    const p = await db.patient.create({ data: { nombre: o.nombre, telefono: o.telefono, fechaNac: new Date(o.fechaNac) } });
    const c = await createCase({ channel: o.canal, patientId: p.id });
    const steps = [
      { to: "ESTUDIO_ELEGIDO", data: { studyId: "lab-quimica" } },
      { to: "CLINICA_ELEGIDA", data: { clinicId: "cln-quintas" } },
      { to: "HORARIO_ELEGIDO", data: { horario: tomorrowAt(9) } },
      { to: "DATOS_CONFIRMADOS", data: {} },
      { to: "CITA_CONFIRMADA", data: {} },
    ] as const;
    let version = c.version;
    for (const s of steps.slice(0, o.hasta)) {
      const r = await advance({ caseId: c.id, to: s.to, data: s.data, channel: o.canal, expectedVersion: version });
      version = r.case.version;
    }
  }

  console.log("Seed listo: Ana (+52 667 000 0001, nac. 1992-04-15), asesor@demo.mx/asesor123, admin@demo.mx/admin123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
