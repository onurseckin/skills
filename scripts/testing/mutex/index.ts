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
  type TestLockOptions,
} from "./test-mutex.ts";
