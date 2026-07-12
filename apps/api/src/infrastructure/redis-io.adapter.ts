import { IoAdapter } from "@nestjs/platform-socket.io";
import type { INestApplicationContext } from "@nestjs/common";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient, type RedisClientType } from "redis";
import type { ServerOptions } from "socket.io";
export class RedisIoAdapter extends IoAdapter {
  private adapter: ReturnType<typeof createAdapter> | null = null;
  private pub?: RedisClientType;
  private sub?: RedisClientType;
  constructor(app: INestApplicationContext) {
    super(app);
  }
  async connect() {
    try {
      this.pub = createClient({
        url: process.env.REDIS_URL ?? "redis://localhost:6379",
        socket: { connectTimeout: 500, reconnectStrategy: false },
      });
      this.sub = this.pub.duplicate();
      this.pub.on("error", () => undefined);
      this.sub.on("error", () => undefined);
      await Promise.all([this.pub.connect(), this.sub.connect()]);
      this.adapter = createAdapter(this.pub, this.sub);
    } catch {
      if (this.pub?.isOpen) await this.pub.disconnect();
      if (this.sub?.isOpen) await this.sub.disconnect();
      this.adapter = null;
    }
  }
  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapter) server.adapter(this.adapter);
    return server;
  }
}
