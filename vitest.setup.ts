import { execSync } from "node:child_process";

// Crea/sincroniza el esquema en la BD de pruebas (sin migraciones; es desechable).
export default function setup() {
  const url = process.env.TEST_DATABASE_URL!;
  execSync("npx prisma db push --skip-generate", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
}
