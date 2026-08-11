import { useCallback, useRef } from "react";

function nonce() {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return cryptoApi?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createStaffIntentKey(domain: string, entityId: string, action: string) {
  return `${domain}:${entityId}:${action}:${nonce()}`;
}

/** One key per user intent; retries reuse it until the server confirms success. */
export function useStaffIntentKey(domain: string, entityId: string | undefined, action: string) {
  const ref = useRef<{ identity: string; key: string } | undefined>(undefined);
  const identity = `${domain}:${entityId ?? "new"}:${action}`;
  if (!ref.current || ref.current.identity !== identity) {
    ref.current = { identity, key: createStaffIntentKey(domain, entityId ?? "new", action) };
  }
  const reset = useCallback(() => { ref.current = undefined; }, []);
  return { key: ref.current.key, reset };
}
