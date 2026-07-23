import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { BookingOtpProcessor } from "./booking-otp.processor.js";

@Injectable()
export class BookingOtpPoller implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private running = false;

  constructor(
    @Inject(BookingOtpProcessor)
    private readonly processor: BookingOtpProcessor,
  ) {}

  onModuleInit() {
    if (process.env.BOOKING_OTP_DELIVERY_DISABLED !== "true")
      this.schedule(100);
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delayMs: number) {
    if (!this.stopped) this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const count = await this.processor.run();
      this.schedule(
        count ? 100 : Number(process.env.BOOKING_OTP_POLL_MS ?? 1000),
      );
    } catch {
      this.schedule(1000);
    } finally {
      this.running = false;
    }
  }
}
