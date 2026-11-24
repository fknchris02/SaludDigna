import { PrismaClient } from "@prisma/client";

// Un solo cliente por proceso (evita fugas de conexiones con el hot reload de Next).
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = db;

export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
