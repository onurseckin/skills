import { describe, expect, it } from "bun:test";
import {
  isPushTargetInert,
  SENSITIVE_PUSH_ENV_VARS,
} from "./remote-safety.ts";

describe("Remote Safety Utilities", () => {
  it("identifies inert push targets accurately", () => {
    expect(isPushTargetInert("no_push")).toBe(true);
    expect(isPushTargetInert("disabled://push-prohibited")).toBe(true);
    expect(isPushTargetInert("dummy://repo")).toBe(true);
    expect(isPushTargetInert("/dev/null")).toBe(true);
    expect(isPushTargetInert("https://github.com/org/repo.git")).toBe(false);
    expect(isPushTargetInert("")).toBe(false);
    expect(isPushTargetInert(undefined)).toBe(false);
  });

  it("exports sensitive push environment variable names list", () => {
    expect(SENSITIVE_PUSH_ENV_VARS).toContain("GITHUB_TOKEN");
    expect(SENSITIVE_PUSH_ENV_VARS).toContain("GIT_AUTH_TOKEN");
    expect(SENSITIVE_PUSH_ENV_VARS).toContain("AWS_ACCESS_KEY_ID");
  });
});
