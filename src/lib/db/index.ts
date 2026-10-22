import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { config } from "@/lib/config";

declare global {
  var __zecwisePool: Pool | undefined;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not set. Configure a Postgres (Supabase) connection string to enable persistence.");
    this.name = "DatabaseNotConfiguredError";
  }
}

export function getPool(): Pool {
  if (!config.databaseUrl) throw new DatabaseNotConfiguredError();
  if (!globalThis.__zecwisePool) {
    globalThis.__zecwisePool = new Pool({
      connectionString: config.databaseUrl,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: /sslmode=require|supabase\.(co|com)/.test(config.databaseUrl) ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalThis.__zecwisePool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
