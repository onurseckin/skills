import { describe, expect, test } from "bun:test";
import * as storeIndex from "../../../olt/scripts/src/store/index.ts";

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
  });
});
