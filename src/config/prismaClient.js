import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

/** @type {PrismaClient | undefined} */
let prisma = globalForPrisma.prisma;

if (!prisma) {
  prisma = new PrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
  }
}

export default prisma;

