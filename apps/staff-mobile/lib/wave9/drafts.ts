import * as SecureStore from "expo-secure-store";

const knownDraftKeys = new Set<string>();

export function draftKey(tenantId: string, userId: string, ownStaffId: string, sessionId: string) {
  const key = `staff-note-draft:${tenantId}:${userId}:${ownStaffId}:${sessionId}`;
  knownDraftKeys.add(key);
  return key;
}

export async function clearStaffLocalDrafts() {
  await Promise.all([...knownDraftKeys].map((key) => SecureStore.deleteItemAsync(key).catch(() => undefined)));
  knownDraftKeys.clear();
}
