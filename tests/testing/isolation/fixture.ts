import {
  createTestIsolationContext,
  type TestIsolationContext,
} from "../../../olt/scripts/src/testing/isolation.ts";

export function createSampleIsolationContext(prefix = "fixture-iso"): TestIsolationContext {
  return createTestIsolationContext({ prefix });
}
