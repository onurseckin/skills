import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  getDefaultMilestoneLockEngine,
  getDefaultSocraticDialecticEngine,
  MilestoneLockEngine,
  resetDefaultMilestoneLockEngine,
  resetDefaultSocraticDialecticEngine,
  setDefaultMilestoneLockEngine,
  setDefaultSocraticDialecticEngine,
  SocraticDialecticEngine,
} from "../../fixtures.ts";

describe("Milestone Locks - Singletons & Factory Functions", () => {
  beforeEach(() => {
    resetDefaultMilestoneLockEngine();
    resetDefaultSocraticDialecticEngine();
  });

  afterEach(() => {
    resetDefaultMilestoneLockEngine();
    resetDefaultSocraticDialecticEngine();
  });

  describe("10. Singletons & Factory Functions", () => {
    it("should manage default singleton for SocraticDialecticEngine", () => {
      const defaultEngine1 = getDefaultSocraticDialecticEngine();
      const defaultEngine2 = getDefaultSocraticDialecticEngine();
      expect(defaultEngine1).toBe(defaultEngine2);

      const customEngine = new SocraticDialecticEngine({ sessionId: "custom-session" });
      setDefaultSocraticDialecticEngine(customEngine);
      expect(getDefaultSocraticDialecticEngine()).toBe(customEngine);

      resetDefaultSocraticDialecticEngine();
      const freshEngine = getDefaultSocraticDialecticEngine();
      expect(freshEngine).not.toBe(customEngine);
    });

    it("should manage default singleton for MilestoneLockEngine", () => {
      const defaultLock1 = getDefaultMilestoneLockEngine();
      const defaultLock2 = getDefaultMilestoneLockEngine();
      expect(defaultLock1).toBe(defaultLock2);

      const customLock = new MilestoneLockEngine("custom-lock-session");
      setDefaultMilestoneLockEngine(customLock);
      expect(getDefaultMilestoneLockEngine()).toBe(customLock);

      resetDefaultMilestoneLockEngine();
      const freshLock = getDefaultMilestoneLockEngine();
      expect(freshLock).not.toBe(customLock);
    });
  });
});
