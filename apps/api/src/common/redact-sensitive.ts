const sensitive = /^(password|code|otp|token|accessToken|refreshToken|mfaToken|secret|secret_encrypted|recoveryCodes|cookie|authorization)$/i;

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === "object") {
    if (value instanceof Error) return { name: value.name, message: value.message };
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sensitive.test(key) ? "[REDACTED]" : redactSensitive(child)]));
  }
  return value;
}
