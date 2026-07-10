import { Injectable, OnModuleDestroy } from "@nestjs/common";
import pg, { type PoolClient, type QueryResultRow } from "pg";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
    max: 10,
  });
  query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
    return this.pool.query<T>(text, values);
  }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async ping() {
    await this.pool.query("SELECT 1");
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
