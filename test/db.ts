import { db } from "@/lib/db";

/** Deja la BD de pruebas vacía con un estudio ("us") y una clínica ("c1"). */
export async function resetDb() {
  await db.event.deleteMany();
  await db.case.deleteMany();
  await db.channelIdentity.deleteMany();
  await db.otpChallenge.deleteMany();
  await db.patient.deleteMany();
  const study = { id: "us", nombre: "Ultrasonido", precio: 45000, preparacion: "Ayuno de 6 horas." };
  const clinic = { id: "c1", nombre: "Clínica Centro", ciudad: "Culiacán", direccion: "x" };
  await db.study.upsert({ where: { id: study.id }, update: study, create: study });
  await db.clinic.upsert({ where: { id: clinic.id }, update: clinic, create: clinic });
}
