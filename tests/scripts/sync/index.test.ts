import { describe, expect, test } from "bun:test";
import {
  areSignalHooksRegistered,
  getActiveCleanupsCount,
  GLOBAL_SYNC_GEN5,
  main,
  orDefault,
  runSync,
} from "../../../scripts/sync/index.ts";

describe("scripts/sync/index.ts facade invariants", () => {
  test("exports signal hook inspectors from git-source", () => {
    expect(typeof areSignalHooksRegistered).toBe("function");
    expect(typeof getActiveCleanupsCount).toBe("function");
    expect(typeof areSignalHooksRegistered()).toBe("boolean");
    expect(typeof getActiveCleanupsCount()).toBe("number");
    expect(getActiveCleanupsCount()).toBeGreaterThanOrEqual(0);
  });

  test("exports gen5 marker and helpers", () => {
    expect(GLOBAL_SYNC_GEN5).toBe(true);
    expect(orDefault("custom", "fallback")).toBe("custom");
    expect(orDefault(undefined, "fallback")).toBe("fallback");
    expect(typeof runSync).toBe("function");
    expect(typeof main).toBe("function");
  });
});
