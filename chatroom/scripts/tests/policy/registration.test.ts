import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { executeCommand, findCommand } from "../../src/cli/index.ts";
import { offCommand, onCommand } from "../../src/cli/commands/index.ts";
import { offSpec, onSpec } from "../../src/cli/registry/index.ts";
import {
  clearNotifyCommand,
  persistNotifyCommand,
  readPolicyJson,
  removeNotifyCommand,
  resolvePolicy,
  resolveTargetPolicyPath,
  setNotifyCommand,
  writePolicyJson,
  type PolicyPorts,
} from "../../src/policy/index.ts";
import { ChatVirtualFS as VirtualMemoryFS } from "../../src/testing/virtual-fs/index.ts";
import type { EnsureDaemonResult } from "../../src/daemon/index.ts";

function createMemoryPorts(vfs: VirtualMemoryFS): PolicyPorts {
  return {
    existsSync: (path: string) => vfs.existsSync(path),
    readFileSync: (path: string, encoding: string) => vfs.readFileSync(path, encoding) as string,
    writeFileSync: (path: string, content: string) => {
      const lastSlash = path.lastIndexOf("/");
      const dir = lastSlash > 0 ? path.substring(0, lastSlash) : "/";
      if (!vfs.existsSync(dir)) {
        vfs.mkdirSync(dir, { recursive: true });
      }
      vfs.writeFileSync(path, content);
    },
    mkdirSync: (path: string, options?: { readonly recursive?: boolean }) => {
      vfs.mkdirSync(path, options);
    },
  };
}

describe("CLI event registration commands and policy persistence", () => {
  let prevChatroomHome: string | undefined;

  beforeAll(() => {
    prevChatroomHome = process.env.CHATROOM_HOME;
    process.env.CHATROOM_HOME = `/virtual/chat-test-${Date.now()}`;
  });

  afterAll(() => {
    if (prevChatroomHome === undefined) {
      delete process.env.CHATROOM_HOME;
    } else {
      process.env.CHATROOM_HOME = prevChatroomHome;
    }
  });

  it("chat:on registers notify_command, calls ensureDaemon, and returns structured brief", async () => {
    const vfs = new VirtualMemoryFS();
    const ports = createMemoryPorts(vfs);
    const policyPath = "/virtual/agents/chatroom/policy.json";

    let daemonInput: { readonly room: string; readonly reader: string } | null = null;
    const mockEnsure = (input: {
      readonly room: string;
      readonly reader: string;
    }): EnsureDaemonResult => {
      daemonInput = input;
      return {
        status: "started",
        pid: 7788,
        healthy: true,
        probedMs: 5,
      };
    };

    const result = await onCommand(
      {
        room: "alpha-room",
        as: "bot-agent",
        command: "notify-send 'new message'",
        json: true,
        policy: policyPath,
      },
      { ensureDaemon: mockEnsure, policyPorts: ports },
      [],
    );

    expect(result["ok"]).toBe(true);
    expect(result["action"]).toBe("register");
    expect(result["room"]).toBe("alpha-room");
    expect(result["as"]).toBe("bot-agent");
    expect(result["command"]).toBe("notify-send 'new message'");
    expect(result["policy_path"]).toBe(policyPath);

    const daemon = result["daemon"] as Record<string, unknown>;
    expect(daemon["status"]).toBe("started");
    expect(daemon["pid"]).toBe(7788);
    expect(daemon["healthy"]).toBe(true);

    expect(daemonInput).toEqual({ room: "alpha-room", reader: "bot-agent" });

    const markdown = result["markdown"] as string;
    expect(markdown.includes("chat:on")).toBe(true);
    expect(markdown.includes("alpha-room")).toBe(true);
    expect(markdown.includes("bot-agent")).toBe(true);
    expect(markdown.includes("REGISTERED")).toBe(true);

    const persisted = readPolicyJson(policyPath, ports);
    expect(persisted["notify_command"]).toBe("notify-send 'new message'");
  });

  it("chat:off removes notify_command and returns confirmation", async () => {
    const vfs = new VirtualMemoryFS();
    const ports = createMemoryPorts(vfs);
    const policyPath = "/virtual/agents/chatroom/policy.json";

    writePolicyJson(
      policyPath,
      { runtime_command: "bun", notify_command: "my-script.sh", poll_interval_ms: 500 },
      ports,
    );

    const result = await offCommand(
      {
        room: "alpha-room",
        as: "bot-agent",
        json: true,
        policy: policyPath,
      },
      { policyPorts: ports },
      [],
    );

    expect(result["ok"]).toBe(true);
    expect(result["action"]).toBe("unregister");
    expect(result["room"]).toBe("alpha-room");
    expect(result["as"]).toBe("bot-agent");
    expect(result["notify_command"]).toBeNull();

    const markdown = result["markdown"] as string;
    expect(markdown.includes("chat:off")).toBe(true);
    expect(markdown.includes("UNREGISTERED")).toBe(true);

    const persisted = readPolicyJson(policyPath, ports);
    expect(persisted["notify_command"]).toBeUndefined();
    expect(persisted["runtime_command"]).toBe("bun");
    expect(persisted["poll_interval_ms"]).toBe(500);
  });

  it("verifies round-trip persistence surviving daemon restarts", () => {
    const vfs = new VirtualMemoryFS();
    const ports = createMemoryPorts(vfs);
    const policyPath = "/virtual/custom/policy.json";

    writePolicyJson(policyPath, { runtime_command: "bun", poll_interval_ms: 1000 }, ports);

    setNotifyCommand("agent-hook.sh", { policyPath, ports });
    let resolved = resolvePolicy({
      userPolicyPath: policyPath,
      ports,
      probeRuntime: false,
    });
    expect(resolved.notify_command).toBe("agent-hook.sh");
    expect(resolved.poll_interval_ms).toBe(1000);

    clearNotifyCommand({ policyPath, ports });
    resolved = resolvePolicy({
      userPolicyPath: policyPath,
      ports,
      probeRuntime: false,
    });
    expect(resolved.notify_command).toBeNull();
    expect(resolved.poll_interval_ms).toBe(1000);
  });

  it("handles empty command validation in persistNotifyCommand", () => {
    expect(() => persistNotifyCommand("")).toThrow();
    expect(() => persistNotifyCommand("   ")).toThrow();
  });

  it("resolves target policy path correctly", () => {
    const custom = resolveTargetPolicyPath({ policyPath: "/explicit/path.json" });
    expect(custom).toBe("/explicit/path.json");

    const userPath = resolveTargetPolicyPath({ userPolicyPath: "/custom/user.json" });
    expect(userPath).toBe("/custom/user.json");
  });

  it("chat:on validates required non-empty arguments", async () => {
    const vfs = new VirtualMemoryFS();
    const ports = createMemoryPorts(vfs);

    let caughtMissingRoom = false;
    try {
      await onCommand({ as: "member-1", command: "cmd-1" }, { policyPorts: ports }, []);
    } catch (err: unknown) {
      caughtMissingRoom = typeof err === "object" && err !== null && "code" in err;
    }
    expect(caughtMissingRoom).toBe(true);

    let caughtEmptyRoom = false;
    try {
      await onCommand(
        { room: "   ", as: "member-1", command: "cmd-1" },
        { policyPorts: ports },
        [],
      );
    } catch (err: unknown) {
      caughtEmptyRoom = typeof err === "object" && err !== null && "code" in err;
    }
    expect(caughtEmptyRoom).toBe(true);

    let caughtMissingAs = false;
    try {
      await onCommand({ room: "room-1", command: "cmd-1" }, { policyPorts: ports }, []);
    } catch (err: unknown) {
      caughtMissingAs = typeof err === "object" && err !== null && "code" in err;
    }
    expect(caughtMissingAs).toBe(true);

    let caughtEmptyAs = false;
    try {
      await onCommand({ room: "room-1", as: "", command: "cmd-1" }, { policyPorts: ports }, []);
    } catch (err: unknown) {
      caughtEmptyAs = typeof err === "object" && err !== null && "code" in err;
    }
    expect(caughtEmptyAs).toBe(true);

    let caughtMissingCommand = false;
    try {
      await onCommand({ room: "room-1", as: "member-1" }, { policyPorts: ports }, []);
    } catch (err: unknown) {
      caughtMissingCommand = typeof err === "object" && err !== null && "code" in err;
    }
    expect(caughtMissingCommand).toBe(true);

    let caughtEmptyCommand = false;
    try {
      await onCommand(
        { room: "room-1", as: "member-1", command: "  " },
        { policyPorts: ports },
        [],
      );
    } catch (err: unknown) {
      caughtEmptyCommand = typeof err === "object" && err !== null && "code" in err;
    }
    expect(caughtEmptyCommand).toBe(true);
  });

  it("chat:off validates required non-empty arguments", async () => {
    const vfs = new VirtualMemoryFS();
    const ports = createMemoryPorts(vfs);

    let caughtMissingRoom = false;
    try {
      await offCommand({ as: "member-1" }, { policyPorts: ports }, []);
    } catch (err: unknown) {
      caughtMissingRoom = typeof err === "object" && err !== null && "code" in err;
    }
    expect(caughtMissingRoom).toBe(true);

    let caughtEmptyRoom = false;
    try {
      await offCommand({ room: "", as: "member-1" }, { policyPorts: ports }, []);
    } catch (err: unknown) {
      caughtEmptyRoom = typeof err === "object" && err !== null && "code" in err;
    }
    expect(caughtEmptyRoom).toBe(true);

    let caughtMissingAs = false;
    try {
      await offCommand({ room: "room-1" }, { policyPorts: ports }, []);
    } catch (err: unknown) {
      caughtMissingAs = typeof err === "object" && err !== null && "code" in err;
    }
    expect(caughtMissingAs).toBe(true);
  });

  it("verifies CLI registry integration and command finding for on and off", () => {
    const foundOn = findCommand("chat:on");
    expect(foundOn).toBeDefined();
    expect(foundOn?.name).toBe("chat:on");

    const foundOnAlias = findCommand("on");
    expect(foundOnAlias).toBeDefined();
    expect(foundOnAlias?.name).toBe("chat:on");

    const foundOff = findCommand("chat:off");
    expect(foundOff).toBeDefined();
    expect(foundOff?.name).toBe("chat:off");

    const foundOffAlias = findCommand("off");
    expect(foundOffAlias).toBeDefined();
    expect(foundOffAlias?.name).toBe("chat:off");

    expect(onSpec.name).toBe("chat:on");
    expect(onSpec.flags.map((f) => f.name)).toContain("room");
    expect(onSpec.flags.map((f) => f.name)).toContain("as");
    expect(onSpec.flags.map((f) => f.name)).toContain("command");

    expect(offSpec.name).toBe("chat:off");
    expect(offSpec.flags.map((f) => f.name)).toContain("room");
    expect(offSpec.flags.map((f) => f.name)).toContain("as");
  });

  it("executes chat:on and chat:off via executeCommand", async () => {
    const vfs = new VirtualMemoryFS();
    const ports = createMemoryPorts(vfs);
    const policyPath = "/virtual/test-cli/policy.json";

    const onRes = await executeCommand(
      [
        "chat:on",
        "--room",
        "integ-room",
        "--as",
        "integ-member",
        "--command",
        "echo integ",
        "--policy",
        policyPath,
        "--json",
      ],
      { policyPorts: ports } as unknown as Record<string, unknown>,
    );

    expect(onRes["ok"]).toBe(true);
    expect(onRes["room"]).toBe("integ-room");
    expect(onRes["command"]).toBe("echo integ");

    const offRes = await executeCommand(
      [
        "chat:off",
        "--room",
        "integ-room",
        "--as",
        "integ-member",
        "--policy",
        policyPath,
        "--json",
      ],
      { policyPorts: ports } as unknown as Record<string, unknown>,
    );

    expect(offRes["ok"]).toBe(true);
    expect(offRes["action"]).toBe("unregister");
  });

  it("handles ensureDaemon failure gracefully in onCommand", async () => {
    const vfs = new VirtualMemoryFS();
    const ports = createMemoryPorts(vfs);
    const policyPath = "/virtual/failure/policy.json";

    const mockFailingEnsure = (): EnsureDaemonResult => {
      return {
        status: "failed",
        pid: null,
        healthy: false,
        probedMs: 2,
      };
    };

    const res = await onCommand(
      {
        room: "fail-room",
        as: "fail-member",
        command: "do-something",
        policy: policyPath,
        json: true,
      },
      { ensureDaemon: mockFailingEnsure, policyPorts: ports },
      [],
    );

    expect(res["ok"]).toBe(true);
    const daemon = res["daemon"] as Record<string, unknown>;
    expect(daemon["status"]).toBe("failed");
    expect(daemon["healthy"]).toBe(false);
  });
});
