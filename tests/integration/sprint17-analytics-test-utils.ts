import pg from "pg";
import { randomUUID } from "node:crypto";

export const tenant = "10000000-0000-4000-8000-000000000001";
export const branch = "20000000-0000-4000-8000-000000000001";
export const connection = () => new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft" });
export const sourceId = () => randomUUID();
