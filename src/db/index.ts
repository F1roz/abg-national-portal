import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgres://abg:abg@localhost:5432/abg_portal";

// Reuse one pool across hot reloads in development.
const g = globalThis as unknown as { __abgSql?: ReturnType<typeof postgres> };
export const sql = g.__abgSql ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") g.__abgSql = sql;

export const db = drizzle(sql, { schema });
export type DB = typeof db;
export * as s from "./schema";
