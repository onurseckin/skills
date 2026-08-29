export let sessionPersistenceObserver:
  | ((step: "file-fsync" | "rename" | "directory-fsync", path: string) => void)
  | undefined;

export let sessionLockCleanupFault: { enabled: boolean; value: unknown } = {
  enabled: false,
  value: undefined,
};

export function setSessionPersistenceObserverForTesting(
  observer: ((step: "file-fsync" | "rename" | "directory-fsync", path: string) => void) | undefined,
): () => void {
  const previous = sessionPersistenceObserver;
  sessionPersistenceObserver = observer;
  return () => {
    sessionPersistenceObserver = previous;
  };
}

export function setSessionLockCleanupFailureForTesting(value: unknown): () => void {
  const previous = sessionLockCleanupFault;
  sessionLockCleanupFault = { enabled: true, value };
  return () => {
    sessionLockCleanupFault = previous;
  };
}
