import { describe, it, expect } from "bun:test";
import {
  enforceIsolatedTaskDispatch,
  atomicAdmissionToDispatch,
} from "../../../olt/scripts/src/mind/lifecycle/index.ts";

describe("mind/mind-pulse", () => {
  it("enforces isolated task dispatch for a candidate", () => {
    const dispatch = enforceIsolatedTaskDispatch("cand-001");
    expect(dispatch.implementerTaskId).toBe("cand-001-impl");
    expect(dispatch.validatorTaskId).toBe("cand-001-val");
    expect(dispatch.writeScope).toEqual(["src/cand-001"]);
  });

  it("handles atomic admission to dispatch", () => {
    expect(atomicAdmissionToDispatch("cand-001")).toBe(true);
  });
});
