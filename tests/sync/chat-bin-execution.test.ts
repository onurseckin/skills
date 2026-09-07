import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { main as chatRootMain } from "../../chatroom/harness.ts";
import { main as chatScriptsMain } from "../../chatroom/scripts/harness.ts";
import { main as oltMain } from "../../olt/scripts/harness.ts";
import { buildChatBinaryContent, ensureGlobalChatBinary } from "../../scripts/sync/chatroom-bin.ts";
import { buildOltBinaryContent, ensureGlobalOltBinary } from "../../scripts/sync/olt-bin.ts";
import {
  cleanupVirtualSyncFS,
  getVirtualSyncFS,
  scratchRoot,
  setupVirtualSyncFS,
} from "./sync-fixture.ts";

let vfs: ReturnType<typeof getVirtualSyncFS>;

beforeEach(() => {
  vfs = setupVirtualSyncFS();
});

afterEach(() => {
  cleanupVirtualSyncFS();
});

async function captureStdout(action: () => Promise<void>): Promise<string> {
  let captured = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    captured += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  };
  try {
    await action();
  } finally {
    process.stdout.write = originalWrite;
  }
  return captured;
}

describe("global binary generator contracts", () => {
  it("generates chat binary pointing to root harness rather than scripts harness", () => {
    const defaultHarness = "${HOME}/.agents/skills/chatroom/harness.ts";
    const content = buildChatBinaryContent(defaultHarness);
    expect(content).toContain(`GLOBAL_HARNESS="${defaultHarness}"`);
    expect(content).not.toContain("chatroom/scripts/harness.ts");
    expect(content).toContain('exec "${BUN_BIN}" "${GLOBAL_HARNESS}" "$@"');
  });

  it("generates olt binary pointing to scripts harness", () => {
    const defaultHarness = "${HOME}/.agents/skills/olt/scripts/harness.ts";
    const content = buildOltBinaryContent(defaultHarness);
    expect(content).toContain(`GLOBAL_HARNESS="${defaultHarness}"`);
    expect(content).toContain('exec "${BUN_BIN}" "${GLOBAL_HARNESS}" "$@"');
  });

  it("ensures global chat binary is deployed into virtual target directory", () => {
    const root = scratchRoot(import.meta.path, "chat-bin-deploy");
    const targetBinDir = join(root, "bin");

    const created = ensureGlobalChatBinary({
      homeDir: root,
      targetBinDir,
    });
    expect(created.status).toBe("created");
    expect(vfs.existsSync(created.binaryPath)).toBe(true);

    const written = vfs.readFileSync(created.binaryPath, "utf-8");
    expect(written).toContain("${HOME}/.agents/skills/chatroom/harness.ts");

    const verified = ensureGlobalChatBinary({
      homeDir: root,
      targetBinDir,
    });
    expect(verified.status).toBe("verified");
  });

  it("ensures global olt binary is deployed into virtual target directory", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-deploy");
    const targetBinDir = join(root, "bin");

    const created = ensureGlobalOltBinary({
      homeDir: root,
      targetBinDir,
    });
    expect(created.status).toBe("created");
    expect(vfs.existsSync(created.binaryPath)).toBe(true);

    const written = vfs.readFileSync(created.binaryPath, "utf-8");
    expect(written).toContain("${HOME}/.agents/skills/olt/scripts/harness.ts");
  });
});

describe("global harness entry point executions", () => {
  it("executes chat root harness --help and produces non-empty catalog output", async () => {
    const output = await captureStdout(async () => {
      await chatRootMain(["--help"]);
    });

    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("### Chatroom CLI");
    expect(output).toContain("chat:rooms");
    expect(output).toContain("chat:doctor");
    expect(output).toContain("chat:init");
  });

  it("executes chat scripts harness --help via re-export and produces non-empty catalog output", async () => {
    const output = await captureStdout(async () => {
      await chatScriptsMain(["--help"]);
    });

    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("### Chatroom CLI");
    expect(output).toContain("chat:rooms");
    expect(output).toContain("chat:doctor");
  });

  it("executes chat root harness chat:rooms with json output", async () => {
    const output = await captureStdout(async () => {
      await chatRootMain(["chat:rooms", "--json"]);
    });

    expect(output.length).toBeGreaterThan(0);
    const parsed = JSON.parse(output.trim()) as {
      readonly rooms: readonly unknown[];
      readonly count: number;
    };
    expect(Array.isArray(parsed.rooms)).toBe(true);
    expect(typeof parsed.count).toBe("number");
  });

  it("executes olt harness --help and produces non-empty command domain table", async () => {
    const output = await captureStdout(async () => {
      await oltMain(["--help"]);
    });

    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("### Harness CLI");
    expect(output).toContain("plan:brainstorm");
    expect(output).toContain("doctor");
    expect(output).toContain("worktree");
  });

  it("executes olt harness help doctor and produces non-empty command specification", async () => {
    const output = await captureStdout(async () => {
      await oltMain(["help", "doctor"]);
    });

    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("### `doctor`");
    expect(output).toContain("Verify capsule integrity");
    expect(output).toContain("--run");
  });
});
