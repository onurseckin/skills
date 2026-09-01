export {
  acquireTestLock,
  isProcessAlive,
  createMemoryLockStore,
  resetLockStore,
  setLockStore,
  getActiveLockStore,
  diskLockStore,
  type LockStore,
  type TestLockData,
} from "./test-mutex.ts";
