import { Injectable } from "@nestjs/common";

type Counter = { value: number; help: string };

@Injectable()
export class ObservabilityService {
  private readonly startedAt = Date.now();
  private readonly counters = new Map<string, Counter>([
    ["nailsoft_http_requests_total", { value: 0, help: "Total HTTP requests" }],
    ["nailsoft_http_errors_total", { value: 0, help: "Total HTTP 5xx responses" }],
  ]);
  private inFlight = 0;

  recordRequest(statusCode: number) {
    this.counters.get("nailsoft_http_requests_total")!.value += 1;
    if (statusCode >= 500) this.counters.get("nailsoft_http_errors_total")!.value += 1;
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  requestStarted() {
    this.inFlight += 1;
  }

  renderPrometheus() {
    const lines = [...this.counters.entries()].map(([name, counter]) => `# HELP ${name} ${counter.help}\n# TYPE ${name} counter\n${name} ${counter.value}`);
    lines.push(`# HELP nailsoft_http_in_flight Current requests in flight\n# TYPE nailsoft_http_in_flight gauge\nnailsoft_http_in_flight ${this.inFlight}`);
    lines.push(`# HELP nailsoft_process_uptime_seconds Process uptime\n# TYPE nailsoft_process_uptime_seconds gauge\nnailsoft_process_uptime_seconds ${((Date.now() - this.startedAt) / 1000).toFixed(3)}`);
    return `${lines.join("\n")}\n`;
  }
}
