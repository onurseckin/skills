/**
 * @file error-fixture.ts
 * In-memory test sandbox fixture for tests/errors domain
 */

import { spyOn } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";

export interface MemoryFsHarness {
  readonly files: Map<string, string | Buffer>;
  readonly dirs: Set<string>;
  restore(): void;
}

let activeHarness: MemoryFsHarness | null = null;
let counter = 0;

export function scratchRoot(callerPath = "err-test", label = "test"): string {
  counter += 1;
  const hash = createHash("sha256")
    .update(`${callerPath}:${label}:${counter}`)
    .digest("hex")
    .slice(0, 8);
  const path = `/virtual/errors/${label}-${counter}-${hash}`;
  activeHarness?.dirs.add(path);
  return path;
}

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
}

export function createMemoryFsHarness(initialDirs: string[] = []): MemoryFsHarness {
  const files = new Map<string, string | Buffer>();
  const dirs = new Set<string>(initialDirs.map((d) => normalize(d)));

  const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
    const s = normalize(String(p));
    return files.has(s) || dirs.has(s);
  });

  const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation((p) => {
    let curr = normalize(String(p));
    dirs.add(curr);
    while (curr && curr !== "/" && curr !== ".") {
      curr = join(curr, "..");
      dirs.add(curr);
    }
    return undefined as unknown as string;
  });

  const writeSpy = spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
    const s = normalize(String(p));
    dirs.add(dirname(s));
    files.set(s, typeof data === "string" ? data : Buffer.from(data as Uint8Array));
  });

  const readSpy = spyOn(fs, "readFileSync").mockImplementation((p, options) => {
    const s = normalize(String(p));
    const val = files.get(s);
    if (val === undefined) {
      throw Object.assign(new Error(`ENOENT: open '${s}'`), { code: "ENOENT" });
    }
    const isUtf8 =
      options === "utf8" ||
      options === "utf-8" ||
      (typeof options === "object" && options?.encoding === "utf8");
    return isUtf8
      ? typeof val === "string"
        ? val
        : val.toString("utf8")
      : typeof val === "string"
        ? Buffer.from(val, "utf8")
        : val;
  });

  const rmSpy = spyOn(fs, "rmSync").mockImplementation((p) => {
    const s = normalize(String(p));
    files.delete(s);
    dirs.delete(s);
    for (const k of files.keys()) if (k.startsWith(s)) files.delete(k);
    for (const d of dirs) if (d.startsWith(s)) dirs.delete(d);
  });

  const realpathSpy = spyOn(fs, "realpathSync").mockImplementation((p) =>
    resolve(normalize(String(p))),
  );

  const harness: MemoryFsHarness = {
    files,
    dirs,
    restore() {
      if (activeHarness === harness) activeHarness = null;
      existsSpy.mockRestore();
      mkdirSpy.mockRestore();
      writeSpy.mockRestore();
      readSpy.mockRestore();
      rmSpy.mockRestore();
      realpathSpy.mockRestore();
    },
  };

  activeHarness = harness;
  return harness;
}
