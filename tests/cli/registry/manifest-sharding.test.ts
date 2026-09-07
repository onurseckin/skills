import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { writeManifest } from "../../../olt/scripts/generate-cli-manifest.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const splitRoot = join(repoRoot, "olt", "references", "cli-capabilities");

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession;

interface CatalogIndexEntry {
  readonly id: string;
  readonly path: string;
}

interface CatalogIndex {
  readonly schema: string;
  readonly domain: string;
  readonly entries: readonly CatalogIndexEntry[];
}

function readCatalog(relativePath: string): CatalogIndex {
  const fullPath = join(splitRoot, relativePath);
  if (!vfs.existsSync(fullPath)) {
    throw new Error(`Catalog index not found: ${fullPath}`);
  }
  const content = vfs.readFileSync(fullPath, "utf-8");
  return JSON.parse(content) as CatalogIndex;
}

function countPhysicalLines(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let lines = bytes[bytes.length - 1] === 10 ? 0 : 1;
  for (const byte of bytes) {
    if (byte === 10) lines += 1;
  }
  return lines;
}

function collectFiles(dir: string): readonly string[] {
  if (!vfs.existsSync(dir)) return [];
  const entries = vfs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectDirectories(dir: string): readonly string[] {
  if (!vfs.existsSync(dir)) return [];
  const entries = vfs.readdirSync(dir, { withFileTypes: true });
  const dirs: string[] = [dir];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      dirs.push(...collectDirectories(join(dir, entry.name)));
    }
  }
  return dirs;
}

function maxGeneratedPhysicalLines(): number {
  const files = collectFiles(splitRoot);
  let maxLines = 0;
  for (const file of files) {
    const lines = countPhysicalLines(vfs.readFileSync(file, null));
    if (lines > maxLines) {
      maxLines = lines;
    }
  }
  return maxLines;
}

function maxGeneratedDirectoryFanout(): number {
  const dirs = collectDirectories(splitRoot);
  let maxFanout = 0;
  for (const dir of dirs) {
    if (
      dir === splitRoot ||
      dir === join(splitRoot, "commands") ||
      dir === join(splitRoot, "domains")
    ) {
      continue;
    }
    const entries = vfs.readdirSync(dir);
    if (entries.length > maxFanout) {
      maxFanout = entries.length;
    }
  }
  return maxFanout;
}

describe("CLI capability manifest sharding and modularity", () => {
  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  test("large domains render bounded semantic shards with indexes", () => {
    writeManifest();
    expect(readCatalog("commands/mind/index.json").entries).toHaveLength(6);
    expect(maxGeneratedPhysicalLines()).toBeLessThanOrEqual(300);
    expect(maxGeneratedDirectoryFanout()).toBeLessThanOrEqual(10);
  });

  test("all generated index.json files follow the catalog index schema", () => {
    writeManifest();
    const largeDomains = ["mind", "reporting", "plan", "task", "diagnostics"] as const;
    for (const domain of largeDomains) {
      const index = readCatalog(`commands/${domain}/index.json`);
      expect(index.schema).toBe("olt-cli-catalog/v1");
      expect(index.domain).toBe(domain);
      expect(Array.isArray(index.entries)).toBeTrue();
      expect(index.entries.length).toBeGreaterThan(0);
      for (const entry of index.entries) {
        expect(typeof entry.id).toBe("string");
        expect(entry.id.length).toBeGreaterThan(0);
        expect(typeof entry.path).toBe("string");
        expect(entry.path.length).toBeGreaterThan(0);
        expect(vfs.existsSync(join(splitRoot, "commands", domain, entry.path))).toBeTrue();
      }
    }
  });

  test("generated domain markdown files satisfy the 400 physical-line limit", () => {
    writeManifest();
    const domainFiles = collectFiles(join(splitRoot, "domains")).filter((path) =>
      path.endsWith(".md"),
    );
    expect(domainFiles.length).toBeGreaterThan(0);
    for (const file of domainFiles) {
      const lines = countPhysicalLines(vfs.readFileSync(file, null));
      expect(lines).toBeLessThanOrEqual(400);
    }
  });

  test("generated command directories satisfy the 10-file fanout limit", () => {
    writeManifest();
    const commandRoot = join(splitRoot, "commands");
    const commandDirs = collectDirectories(commandRoot);
    for (const dir of commandDirs) {
      if (dir === commandRoot) continue;
      const entries = vfs.readdirSync(dir);
      expect(entries.length).toBeLessThanOrEqual(10);
    }
  });

  test("all generated files and directories under cli-capabilities satisfy modularity constraints", () => {
    writeManifest();
    expect(maxGeneratedPhysicalLines()).toBeLessThanOrEqual(300);
    expect(maxGeneratedDirectoryFanout()).toBeLessThanOrEqual(10);
  });
});
