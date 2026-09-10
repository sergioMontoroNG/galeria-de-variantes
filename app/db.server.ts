import { PrismaClient } from "@prisma/client";

// Neon's free tier suspends the database after a period of inactivity;
// waking it back up can take longer than Prisma's default 10s pool timeout,
// which surfaces as "Timed out fetching a new connection from the connection
// pool" on the first request after idle. Widening the timeouts lets Prisma
// wait out that cold start instead of failing the request.
function databaseUrl() {
  const url = new URL(process.env.DATABASE_URL!);
  if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "20");
  if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "20");
  return url.toString();
}

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient({ datasourceUrl: databaseUrl() });
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient({ datasourceUrl: databaseUrl() });

export default prisma;
