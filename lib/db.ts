import { PrismaClient as LocalPrismaClient } from "@prisma/client";
import { PrismaClient as NeonPrismaClient } from "../prisma/generated/neon-client";

type PrismaDbClient = LocalPrismaClient;

// Standard Next.js-safe Prisma singleton -- avoids duplicate clients during
// hot reloading in dev.
process.env.DATABASE_URL ??= "file:./dev.db";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaDbClient };

function createPrismaClient(): PrismaDbClient {
  if (process.env.NEON_DATABASE_URL) {
    return new NeonPrismaClient() as unknown as PrismaDbClient;
  }

  return new LocalPrismaClient();
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
