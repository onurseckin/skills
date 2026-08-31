let inMemorySessionStore: Map<string, string> | undefined;

export function enableInMemorySessionStore(initial?: Record<string, string>): Map<string, string> {
  return (inMemorySessionStore = new Map(Object.entries(initial ?? {})));
}

export function disableInMemorySessionStore(): void {
  inMemorySessionStore = undefined;
}

export function clearInMemorySessionStore(): void {
  inMemorySessionStore?.clear();
}

export function isInMemorySessionStoreEnabled(): boolean {
  return inMemorySessionStore !== undefined;
}

export function getInMemorySessionStore(): Map<string, string> | undefined {
  return inMemorySessionStore;
}

export function setInMemorySessionData(path: string, payload: string): void {
  inMemorySessionStore?.set(path, payload);
}

export function getInMemorySessionData(path: string): string | undefined {
  return inMemorySessionStore?.get(path);
}

export function deleteInMemorySessionData(path: string): boolean {
  return inMemorySessionStore?.delete(path) ?? false;
}
