import { describe, expect, it } from "bun:test";
import {
  auditEnvironmentCredentials,
  auditRemoteUrls,
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

  it("audits remote URLs safely with in-memory spawner", () => {
    const encoder = new TextEncoder();
    const mockSpawn = () => ({
      exitCode: 0,
      stdout: encoder.encode(
        "origin\thttps://github.com/org/repo.git\t(fetch)\norigin\tno_push\t(push)\n",
      ),
      stderr: new Uint8Array(0),
    });

    const result = auditRemoteUrls("/tmp/fake-repo", mockSpawn);
    expect(result.ok).toBe(true);
    expect(result.remotes.origin?.push).toBe("no_push");
    expect(result.issues).toHaveLength(0);
  });

  it("detects active push remote URLs as safety violations", () => {
    const encoder = new TextEncoder();
    const mockSpawn = () => ({
      exitCode: 0,
      stdout: encoder.encode(
        "origin\thttps://github.com/org/repo.git\t(fetch)\norigin\thttps://github.com/org/repo.git\t(push)\n",
      ),
      stderr: new Uint8Array(0),
    });

    const result = auditRemoteUrls("/tmp/fake-repo", mockSpawn);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("active push URL");
  });

  it("handles git remote command failure", () => {
    const encoder = new TextEncoder();
    const mockSpawn = () => ({
      exitCode: 128,
      stdout: new Uint8Array(0),
      stderr: encoder.encode("fatal: not a git repository"),
    });

    const result = auditRemoteUrls("/tmp/fake-repo", mockSpawn);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("fatal: not a git repository");
  });

  it("audits environment credentials for sensitive push variables", () => {
    const safeEnv = { NODE_ENV: "test", PATH: "/bin" };
    const safeResult = auditEnvironmentCredentials(safeEnv);
    expect(safeResult.ok).toBe(true);
    expect(safeResult.violations).toHaveLength(0);

    const dirtyEnv = { GITHUB_TOKEN: "secret123", AWS_ACCESS_KEY_ID: "akid" };
    const dirtyResult = auditEnvironmentCredentials(dirtyEnv);
    expect(dirtyResult.ok).toBe(false);
    expect(dirtyResult.violations).toHaveLength(2);
  });
});
