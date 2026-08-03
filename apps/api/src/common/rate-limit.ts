export type RateLimitDecision = { allowed: boolean; limit: number; remaining: number; resetAt: number };

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function rateLimitDecision(key: string, limit = 120, windowMs = 60_000, now = Date.now()): RateLimitDecision {
  const existing = buckets.get(key);
  const bucket = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + windowMs } : existing;
  bucket.count += 1;
  buckets.set(key, bucket);
  if (buckets.size > 10_000) for (const [entryKey, entry] of buckets) if (entry.resetAt <= now) buckets.delete(entryKey);
  return { allowed: bucket.count <= limit, limit, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
}

export function isSensitiveRoute(url: string) {
  return /\/(auth|otp|password|mfa|public-booking|export|provider|webhook)/i.test(url);
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
