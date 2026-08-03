import { Injectable, OnModuleDestroy } from "@nestjs/common";
import pg, { type PoolClient, type QueryResultRow } from "pg";
import { loadRuntimeConfig } from "@nailsoft/config";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly config = loadRuntimeConfig();
  private readonly pool = new pg.Pool({
    connectionString: this.config.DATABASE_URL,
    max: this.config.DB_POOL_MAX,
    connectionTimeoutMillis: this.config.DB_CONNECTION_TIMEOUT_MS,
    statement_timeout: this.config.DB_STATEMENT_TIMEOUT_MS,
    options: `-c lock_timeout=${this.config.DB_LOCK_TIMEOUT_MS} -c idle_in_transaction_session_timeout=${this.config.DB_IDLE_TRANSACTION_TIMEOUT_MS}`,
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
