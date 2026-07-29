import { createHmac, timingSafeEqual } from "node:crypto";

export type ConsentState = "GRANTED" | "WITHDRAWN" | "NOT_GRANTED" | "UNKNOWN";
export function reduceConsent(
  current: ConsentState,
  event: string,
): ConsentState {
  if (event === "GRANT") return "GRANTED";
  if (event === "WITHDRAW" || event === "EXPIRE") return "WITHDRAWN";
  if (event === "MIGRATION")
    return current === "GRANTED" ? "GRANTED" : "NOT_GRANTED";
  if (event === "ADMIN_CORRECTION") return current;
  throw new Error("CONSENT_EVENT_INVALID");
}

export const campaignTransitions: Record<string, string[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "CANCELLED"],
  APPROVED: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["RUNNING", "CANCELLED"],
  RUNNING: ["PAUSED", "COMPLETED", "FAILED", "CANCELLED"],
  PAUSED: ["RUNNING", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
};
export const recoveryTransitions: Record<string, string[]> = {
  OPEN: ["TRIAGED", "CANCELLED"],
  TRIAGED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "RESOLVED", "CANCELLED"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
  CANCELLED: [],
};
export function assertTransition(
  map: Record<string, string[]>,
  from: string,
  to: string,
  code: string,
) {
  if (!map[from]?.includes(to)) throw Object.assign(new Error(code), { code });
}

export function signPublicToken(
  payload: Record<string, unknown>,
  secret: string,
) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}
export function verifyPublicToken(token: string, secret: string) {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) throw new Error("PUBLIC_TOKEN_INVALID");
  const expected = createHmac("sha256", secret).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("PUBLIC_TOKEN_INVALID");
  const payload = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now())
    throw new Error("PUBLIC_TOKEN_EXPIRED");
  return payload;
}

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
export function sanitizeTemplate(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*(["']).*?\1/gi, "")
    .replace(/javascript:/gi, "");
}
export function renderTemplate(
  source: string,
  variables: Record<string, unknown>,
  allowed: string[],
  required: string[],
) {
  for (const key of required)
    if (variables[key] === undefined || variables[key] === null)
      throw new Error("FAILED_RENDER");
  return sanitizeTemplate(
    source.replace(/{{\s*([a-zA-Z][\w.]*)\s*}}/g, (_match, key: string) => {
      if (!allowed.includes(key)) throw new Error("FAILED_RENDER");
      return escapeHtml(variables[key]);
    }),
  );
}

export function isQuietHour(
  localHour: number,
  startHour: number,
  endHour: number,
) {
  return startHour > endHour
    ? localHour >= startHour || localHour < endHour
    : localHour >= startHour && localHour < endHour;
}
export function frequencyAllowed(sentCount: number, limit: number) {
  return sentCount < limit;
}
export function reviewEligible(input: {
  appointmentStatus: string;
  invoiceStatus: string;
  emailStatus: string;
  allowed: boolean;
}) {
  return (
    input.appointmentStatus === "COMPLETED" &&
    input.invoiceStatus === "ISSUED" &&
    input.emailStatus === "VERIFIED" &&
    input.allowed
  );
}
export function recoverySlaHours(severity: string) {
  return (
    (
      {
        CRITICAL: [1, 24],
        HIGH: [4, 48],
        MEDIUM: [24, 96],
        LOW: [48, 168],
      } as Record<string, [number, number]>
    )[severity] ?? [48, 168]
  );
}
