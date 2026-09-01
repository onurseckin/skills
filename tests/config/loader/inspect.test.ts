import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { inspectHarnessConfigFile } from "../../../olt/scripts/src/core/config/parser.ts";

const writeFileSync = (p: fs.PathOrFileDescriptor, d: string | NodeJS.ArrayBufferView) =>
  fs.writeFileSync(p, d);

describe("inspectHarnessConfigFile", () => {
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];
  let dirCounter = 0;

  function makeTempDir(label: string): string {
    const dir = `/virtual/cfg-inspect-${++dirCounter}-${label}`;
    mockDirs.add(dir);
    return dir;
  }

  const origExists = fs.existsSync.bind(fs);
  const origRead = fs.readFileSync.bind(fs);
  const isVirt = (s: string) => s.startsWith("/virtual/") || s.startsWith("/tmp/");

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) =>
        isVirt(String(p)) ? mockFiles.has(String(p)) || mockDirs.has(String(p)) : origExists(p),
      ),
      spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike) => {
        mockDirs.add(String(p));
        return undefined as unknown as string;
      }) as unknown as typeof fs.mkdirSync),
      spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor) => {
        if (isVirt(String(p))) {
          const val = mockFiles.get(String(p));
          if (val !== undefined) return val;
          throw new Error(`ENOENT: ${String(p)}`);
        }
        return origRead(p as never);
      }) as unknown as typeof fs.readFileSync),
      spyOn(fs, "writeFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        d: string | NodeJS.ArrayBufferView,
      ) => {
        mockFiles.set(
          String(p),
          typeof d === "string"
            ? d
            : Buffer.from(d.buffer, d.byteOffset, d.byteLength).toString("utf8"),
        );
      }) as unknown as typeof fs.writeFileSync),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
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
    writeFileSync(filePath, JSON.stringify({ max_repair_rounds: 6 }));
    const result = inspectHarnessConfigFile(filePath);
    expect(result.status).toBe("valid_custom");
    expect(result.partial.max_repair_rounds).toBe(6);
    expect(result.filePath).toBe(filePath);
    expect(result.error).toBeUndefined();
  });

  test("reports invalid_custom and preserves the diagnosis for a malformed file, without throwing", () => {
    const dir = makeTempDir("inspect-malformed");
    const filePath = join(dir, "harness.config.json");
    writeFileSync(filePath, "{ not valid json }");
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
    writeFileSync(filePath, JSON.stringify(["not", "an", "object"]));
    const result = inspectHarnessConfigFile(filePath);
    expect(result.status).toBe("invalid_custom");
    expect(result.error).toContain("must contain a JSON object");
  });
});
