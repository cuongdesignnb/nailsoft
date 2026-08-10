import { useCallback, useRef } from "react";

function nonce() {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return cryptoApi?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createIntentKey(domain: string, entityId: string, action: string) {
  return `${domain}:${entityId}:${action}:${nonce()}`;
}

/** A key is created once for one user intent and survives rerenders/retries. */
export function useIntentKey(domain: string, entityId: string | undefined, action: string) {
  const keyRef = useRef<{ identity: string; key: string } | undefined>(undefined);
  const identity = `${domain}:${entityId ?? "new"}:${action}`;
  if (!keyRef.current || keyRef.current.identity !== identity) keyRef.current = { identity, key: createIntentKey(domain, entityId ?? "new", action) };
  const reset = useCallback(() => { keyRef.current = undefined; }, []);
  return { key: keyRef.current!.key, reset };
}
