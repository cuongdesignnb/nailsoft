export type AlertSignal = { emit: boolean; resolved: boolean; state: "OPEN" | "RESOLVED" };

/** Provider-neutral alert state machine. Persistence/transport is deliberately outside this class. */
export class AlertDeduper {
  private readonly states = new Map<string, "OPEN" | "RESOLVED">();

  observe(key: string, active: boolean): AlertSignal {
    const previous = this.states.get(key);
    if (active) {
      const emit = previous !== "OPEN";
      this.states.set(key, "OPEN");
      return { emit, resolved: false, state: "OPEN" };
    }
    const resolved = previous === "OPEN";
    this.states.set(key, "RESOLVED");
    return { emit: false, resolved, state: "RESOLVED" };
  }

  clear() { this.states.clear(); }
}
