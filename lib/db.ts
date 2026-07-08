import { PrismaClient } from "@prisma/client";

// Standard Next.js-safe Prisma singleton -- avoids exhausting Neon's
// connection limit from hot-reloading in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
