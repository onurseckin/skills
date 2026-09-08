import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  daemonSpec,
  findCommand,
  offSpec,
  onSpec,
  readSpec,
  saySpec,
} from "../../chatroom/scripts/src/cli/registry/index.ts";
import { resolvePolicy } from "../../chatroom/scripts/src/policy/resolve.ts";
import {
  cleanupVirtualChatroomFS,
  getVirtualChatroomFS,
  setupVirtualChatroomFS,
} from "./helpers.ts";
import {
  TEST_MODULE as CHATROOM_ROOT_MODULE,
  discoverTests as discoverChatroomRootTests,
  suites as chatroomRootSuites,
} from "./index.ts";
import {
  TEST_MODULE as DAEMON_MODULE,
  discoverTests as discoverDaemonTests,
  suites as daemonSuites,
} from "./daemon/index.ts";
import {
  TEST_MODULE as LOG_MODULE,
  discoverTests as discoverLogTests,
  suites as logSuites,
} from "./log/index.ts";
import {
  TEST_MODULE as POLICY_MODULE,
  discoverTests as discoverPolicyTests,
  suites as policySuites,
} from "./policy/index.ts";
import {
  TEST_MODULE as PROVISION_MODULE,
  discoverTests as discoverProvisionTests,
  suites as provisionSuites,
} from "./provision/index.ts";
import {
  TEST_MODULE as CORE_MODULE,
  discoverTests as discoverCoreTests,
  suites as coreSuites,
} from "../../chatroom/scripts/tests/core/index.ts";
import {
  TEST_MODULE as DEFECTS_MODULE,
  discoverTests as discoverDefectsTests,
  suites as defectsSuites,
} from "../../chatroom/scripts/tests/defects/index.ts";

beforeEach(() => {
  setupVirtualChatroomFS();
});

afterEach(() => {
  cleanupVirtualChatroomFS();
});

describe("chatroom naming and canonical entrypoints", () => {
  it("resolves canonical commands via aliases and prefixes", () => {
    expect(findCommand("say")).toBe(saySpec);
    expect(findCommand("send")).toBe(saySpec);
    expect(findCommand("chat:say")).toBe(saySpec);
    expect(findCommand("chatroom:say")).toBe(saySpec);
    expect(findCommand("chatroom:send")).toBe(saySpec);
    expect(findCommand("read")).toBe(readSpec);
    expect(findCommand("chat:read")).toBe(readSpec);
    expect(findCommand("chatroom:read")).toBe(readSpec);
    expect(findCommand("on")).toBe(onSpec);
    expect(findCommand("chatroom:on")).toBe(onSpec);
    expect(findCommand("off")).toBe(offSpec);
    expect(findCommand("chatroom:off")).toBe(offSpec);
    expect(findCommand("daemon")).toBe(daemonSpec);
    expect(findCommand("chatroom:daemon")).toBe(daemonSpec);
  });

  it("resolves policy with cli_path and harness_path without requiring harness.ts", () => {
    const vfs = getVirtualChatroomFS();
    const virtualShipped = "/virtual/chatroom/policy.json";
    const virtualRepo = "/virtual/repo";
    const virtualLocalCli = "/virtual/repo/chatroom/scripts/cli.ts";

    vfs.mkdirSync("/virtual/chatroom", { recursive: true });
    vfs.mkdirSync("/virtual/repo/chatroom/scripts", { recursive: true });
    vfs.writeFileSync(
      virtualShipped,
      JSON.stringify({
        runtime_command: "bun",
        cli_path: "~/.agents/skills/chatroom/scripts/cli.ts",
      }),
    );
    vfs.writeFileSync(virtualLocalCli, "export async function main() {}");

    const resolved = resolvePolicy({
      shippedPolicyPath: virtualShipped,
      userPolicyPath: "/virtual/nonexistent/user/policy.json",
      repoRoot: virtualRepo,
      env: { CHATROOM_RUNTIME_COMMAND: "bun" },
      probeRuntime: false,
      ports: {
        existsSync: (p: string): boolean => vfs.existsSync(p),
        readFileSync: (p: string): string => vfs.readFileSync(p, "utf-8"),
      },
    });

    expect(resolved.cli_path).toBeDefined();
    expect(resolved.cli_path).toBe(virtualLocalCli);
    expect(resolved.harness_path).toBe(virtualLocalCli);
    expect(resolved.cli_path).not.toContain("harness.ts");
  });

  it("prioritizes root cli over index fallback in virtual repository", () => {
    const vfs = getVirtualChatroomFS();
    const virtualShipped = "/virtual/chatroom/policy.json";
    const virtualRepo = "/virtual/repo2";
    const virtualRootCli = "/virtual/repo2/chatroom/cli.ts";

    vfs.mkdirSync("/virtual/chatroom", { recursive: true });
    vfs.mkdirSync("/virtual/repo2/chatroom", { recursive: true });
    vfs.writeFileSync(
      virtualShipped,
      JSON.stringify({
        runtime_command: "bun",
        cli_path: "/virtual/missing/cli.ts",
      }),
    );
    vfs.writeFileSync(virtualRootCli, "export async function main() {}");

    const resolved = resolvePolicy({
      shippedPolicyPath: virtualShipped,
      userPolicyPath: "/virtual/nonexistent/user/policy.json",
      repoRoot: virtualRepo,
      env: { CHATROOM_RUNTIME_COMMAND: "bun" },
      probeRuntime: false,
      ports: {
        existsSync: (p: string): boolean => vfs.existsSync(p),
        readFileSync: (p: string): string => vfs.readFileSync(p, "utf-8"),
      },
    });

    expect(resolved.cli_path).toBe(virtualRootCli);
    expect(resolved.harness_path).toBe(virtualRootCli);
  });

  it("runtime derives test suites and module identifiers across test facades", () => {
    expect(CHATROOM_ROOT_MODULE).toBe("chatroom-root");
    expect(chatroomRootSuites).toContain("naming-entrypoints");
    expect(discoverChatroomRootTests()).toEqual(chatroomRootSuites);

    expect(DAEMON_MODULE).toBe("chatroom-daemon");
    expect(daemonSuites).toContain("daemon-contiguous-ack");
    expect(discoverDaemonTests()).toEqual(daemonSuites);

    expect(LOG_MODULE).toBe("chatroom-log");
    expect(logSuites).toContain("log-segment-rolling");
    expect(discoverLogTests()).toEqual(logSuites);

    expect(POLICY_MODULE).toBe("chatroom-policy");
    expect(policySuites).toContain("notify-resolution");
    expect(discoverPolicyTests()).toEqual(policySuites);

    expect(PROVISION_MODULE).toBe("chatroom-provision");
    expect(provisionSuites).toContain("generate-hosts");
    expect(discoverProvisionTests()).toEqual(provisionSuites);

    expect(CORE_MODULE).toBe("chatroom-core");
    expect(coreSuites).toContain("atomic-durability");
    expect(discoverCoreTests()).toEqual(coreSuites);

    expect(DEFECTS_MODULE).toBe("chatroom-defects");
    expect(defectsSuites).toContain("defect_D10_corruption_fails_closed");
    expect(discoverDefectsTests()).toEqual(defectsSuites);
  });
});
