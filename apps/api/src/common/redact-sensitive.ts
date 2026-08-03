const sensitive = /^(password|passcode|code|otp|token|accessToken|refreshToken|mfaToken|secret|secret_encrypted|recoveryCodes|cookie|authorization|api[-_]?key|client[-_]?secret|private[-_]?key|signature|webhook[-_]?secret)$/i;

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === "object") {
    if (value instanceof Error) return { name: value.name, message: value.message };
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sensitive.test(key) ? "[REDACTED]" : redactSensitive(child)]));
  }
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
      .replace(/(?:postgres(?:ql)?|mysql):\/\/[^\s"']+/gi, "[REDACTED_DATABASE_URL]")
      .replace(/([?&](?:token|signature|x-amz-signature|x-amz-credential)=)[^&\s]+/gi, "$1[REDACTED]");
  }
  return value;
}
