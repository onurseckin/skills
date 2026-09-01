import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { inspectHarnessConfigFile } from "../../../olt/scripts/src/core/config/parser.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("inspectHarnessConfigFile", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;
  let dirCounter = 0;

  function makeTempDir(label: string): string {
    const dir = `/virtual/cfg-inspect-${++dirCounter}-${label}`;
    vfs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  test("reports auto_detected for a file that does not exist, without throwing", () => {
    const dir = makeTempDir("inspect-absent");
    const filePath = join(dir, "harness.config.json");
    const result = inspectHarnessConfigFile(filePath);
    expect(result).toEqual({ status: "auto_detected", partial: {}, filePath });
  });

  test("reports valid_custom and preserves the parsed partial for a well-formed file", () => {
    const dir = makeTempDir("inspect-valid");
    const filePath = join(dir, "harness.config.json");
    vfs.writeFileSync(filePath, JSON.stringify({ max_repair_rounds: 6 }));
    const result = inspectHarnessConfigFile(filePath);
    expect(result.status).toBe("valid_custom");
    expect(result.partial.max_repair_rounds).toBe(6);
    expect(result.filePath).toBe(filePath);
    expect(result.error).toBeUndefined();
  });

  test("reports invalid_custom and preserves the diagnosis for a malformed file, without throwing", () => {
    const dir = makeTempDir("inspect-malformed");
    const filePath = join(dir, "harness.config.json");
    vfs.writeFileSync(filePath, "{ not valid json }");
    const result = inspectHarnessConfigFile(filePath);
    expect(result.status).toBe("invalid_custom");
    expect(result.partial).toEqual({});
    expect(result.filePath).toBe(filePath);
    expect(typeof result.error).toBe("string");
    expect(result.error).toContain(filePath);
  });

  test("reports invalid_custom for a well-formed but non-object root, preserving the diagnosis", () => {
    const dir = makeTempDir("inspect-non-object");
    const filePath = join(dir, "harness.config.json");
    vfs.writeFileSync(filePath, JSON.stringify(["not", "an", "object"]));
    const result = inspectHarnessConfigFile(filePath);
    expect(result.status).toBe("invalid_custom");
    expect(result.error).toContain("must contain a JSON object");
  });
});
