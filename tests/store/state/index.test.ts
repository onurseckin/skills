import { describe, expect, test } from "bun:test";
import * as storeIndex from "../../../olt/scripts/src/engine/store/index.ts";

describe("store barrel exports", () => {
  test("re-exports the public store API surface", () => {
    expect(typeof storeIndex.initRun).toBe("function");
    expect(typeof storeIndex.loadRun).toBe("function");
    expect(typeof storeIndex.recoverProjection).toBe("function");
    expect(typeof storeIndex.transact).toBe("function");
    expect(typeof storeIndex.verifyIntegrity).toBe("function");
    expect(typeof storeIndex.verifyCapsuleDeep).toBe("function");
    expect(typeof storeIndex.indexFreshness).toBe("function");
    expect(typeof storeIndex.loadIndex).toBe("function");
    expect(typeof storeIndex.appendCapsuleDefect).toBe("function");
    expect(typeof storeIndex.loadCapsuleDefects).toBe("function");
    expect(typeof storeIndex.compactCapsuleDefects).toBe("function");
    expect(typeof storeIndex.resolveCapsuleDefect).toBe("function");
    expect(typeof storeIndex.pruneCapsuleBoilerplate).toBe("function");
    expect(typeof storeIndex.archiveCapsule).toBe("function");
    expect(typeof storeIndex.consolidateCapsules).toBe("function");
    expect(typeof storeIndex.isEffectivelyEmptyDirectory).toBe("function");
    expect(Array.isArray(storeIndex.BOILERPLATE_CAPSULE_SUBDIRECTORIES)).toBe(true);
  });
});
