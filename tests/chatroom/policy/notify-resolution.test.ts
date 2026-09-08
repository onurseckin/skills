import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { resolvePolicy } from "../../../chatroom/scripts/src/policy/resolve.ts";

const SHIPPED_POLICY_PATH = resolve(import.meta.dir, "../../../chatroom/policy.json");
const BASE_ENV = { CHATROOM_RUNTIME_COMMAND: "bun" };

describe("policy notify_command resolution", () => {
  it("defaults to null when policy.json has notify_command null and env is unset", () => {
    const resolved = resolvePolicy({
      shippedPolicyPath: SHIPPED_POLICY_PATH,
      userPolicyPath: "/nonexistent/user/policy.json",
      repoRoot: "/nonexistent/repo",
      env: { ...BASE_ENV },
      probeRuntime: false,
    });
    expect(resolved.notify_command).toBeNull();
  });

  it("populates notify_command from CHATROOM_NOTIFY_COMMAND when policy.json is null", () => {
    const resolved = resolvePolicy({
      shippedPolicyPath: SHIPPED_POLICY_PATH,
      userPolicyPath: "/nonexistent/user/policy.json",
      repoRoot: "/nonexistent/repo",
      env: {
        ...BASE_ENV,
        CHATROOM_NOTIFY_COMMAND: "curl -s -X POST https://hooks.example.com/respawn",
      },
      probeRuntime: false,
    });
    expect(resolved.notify_command).toBe("curl -s -X POST https://hooks.example.com/respawn");
  });

  it("trims whitespace from CHATROOM_NOTIFY_COMMAND env var", () => {
    const resolved = resolvePolicy({
      shippedPolicyPath: SHIPPED_POLICY_PATH,
      userPolicyPath: "/nonexistent/user/policy.json",
      repoRoot: "/nonexistent/repo",
      env: {
        ...BASE_ENV,
        CHATROOM_NOTIFY_COMMAND: "   osascript -e 'display notification \"respawned\"'   ",
      },
      probeRuntime: false,
    });
    expect(resolved.notify_command).toBe("osascript -e 'display notification \"respawned\"'");
  });

  it("treats empty string in CHATROOM_NOTIFY_COMMAND as null", () => {
    const resolved = resolvePolicy({
      shippedPolicyPath: SHIPPED_POLICY_PATH,
      userPolicyPath: "/nonexistent/user/policy.json",
      repoRoot: "/nonexistent/repo",
      env: {
        ...BASE_ENV,
        CHATROOM_NOTIFY_COMMAND: "",
      },
      probeRuntime: false,
    });
    expect(resolved.notify_command).toBeNull();
  });

  it("treats whitespace-only CHATROOM_NOTIFY_COMMAND as null", () => {
    const resolved = resolvePolicy({
      shippedPolicyPath: SHIPPED_POLICY_PATH,
      userPolicyPath: "/nonexistent/user/policy.json",
      repoRoot: "/nonexistent/repo",
      env: {
        ...BASE_ENV,
        CHATROOM_NOTIFY_COMMAND: "     ",
      },
      probeRuntime: false,
    });
    expect(resolved.notify_command).toBeNull();
  });

  it("treats literal null string in CHATROOM_NOTIFY_COMMAND as null", () => {
    const resolved = resolvePolicy({
      shippedPolicyPath: SHIPPED_POLICY_PATH,
      userPolicyPath: "/nonexistent/user/policy.json",
      repoRoot: "/nonexistent/repo",
      env: {
        ...BASE_ENV,
        CHATROOM_NOTIFY_COMMAND: "null",
      },
      probeRuntime: false,
    });
    expect(resolved.notify_command).toBeNull();
  });

  it("treats literal undefined string in CHATROOM_NOTIFY_COMMAND as null", () => {
    const resolved = resolvePolicy({
      shippedPolicyPath: SHIPPED_POLICY_PATH,
      userPolicyPath: "/nonexistent/user/policy.json",
      repoRoot: "/nonexistent/repo",
      env: {
        ...BASE_ENV,
        CHATROOM_NOTIFY_COMMAND: "undefined",
      },
      probeRuntime: false,
    });
    expect(resolved.notify_command).toBeNull();
  });

  it("overrides policy file value with valid CHATROOM_NOTIFY_COMMAND", () => {
    const vfs: Record<string, string> = {
      "/virtual/user/policy.json": JSON.stringify({
        runtime_command: "bun",
        notify_command: "old-script.sh",
      }),
    };
    const resolved = resolvePolicy({
      shippedPolicyPath: SHIPPED_POLICY_PATH,
      userPolicyPath: "/virtual/user/policy.json",
      repoRoot: "/nonexistent/repo",
      env: {
        ...BASE_ENV,
        CHATROOM_NOTIFY_COMMAND: "new-webhook.sh",
      },
      probeRuntime: false,
      ports: {
        existsSync: (p: string): boolean => p in vfs,
        readFileSync: (p: string): string => vfs[p] ?? "",
      },
    });
    expect(resolved.notify_command).toBe("new-webhook.sh");
  });

  it("overrides policy file value to null when CHATROOM_NOTIFY_COMMAND is empty", () => {
    const vfs: Record<string, string> = {
      "/virtual/user/policy.json": JSON.stringify({
        runtime_command: "bun",
        notify_command: "old-script.sh",
      }),
    };
    const resolved = resolvePolicy({
      shippedPolicyPath: SHIPPED_POLICY_PATH,
      userPolicyPath: "/virtual/user/policy.json",
      repoRoot: "/nonexistent/repo",
      env: {
        ...BASE_ENV,
        CHATROOM_NOTIFY_COMMAND: "",
      },
      probeRuntime: false,
      ports: {
        existsSync: (p: string): boolean => p in vfs,
        readFileSync: (p: string): string => vfs[p] ?? "",
      },
    });
    expect(resolved.notify_command).toBeNull();
  });

  it("falls back to user policy notify_command when CHATROOM_NOTIFY_COMMAND is unset", () => {
    const vfs: Record<string, string> = {
      "/virtual/user/policy.json": JSON.stringify({
        runtime_command: "bun",
        notify_command: "user-script.sh",
      }),
    };
    const resolved = resolvePolicy({
      shippedPolicyPath: SHIPPED_POLICY_PATH,
      userPolicyPath: "/virtual/user/policy.json",
      repoRoot: "/nonexistent/repo",
      env: { ...BASE_ENV },
      probeRuntime: false,
      ports: {
        existsSync: (p: string): boolean => p in vfs,
        readFileSync: (p: string): string => vfs[p] ?? "",
      },
    });
    expect(resolved.notify_command).toBe("user-script.sh");
  });
});
