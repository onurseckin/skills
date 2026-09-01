import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  SkillAuditorEngine,
  type AuditorCursor,
} from "../../../../olt/scripts/src/mind/auditing/cognitive/index.ts";

const origExists = fs.existsSync;
const origReaddir = fs.readdirSync;
const origRead = fs.readFileSync;

describe("SkillAuditorEngine in-memory virtual suite", () => {
  const testDir = `${process.cwd()}/.olt/virtual-test-skill-auditor`;
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();

    mockDirs.add(testDir);
    mockDirs.add(join(testDir, ".olt"));
    mockDirs.add(join(testDir, ".olt", "capsules"));

    spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
      const pathStr = String(p);
      if (mockFiles.has(pathStr) || mockDirs.has(pathStr)) return true;
      try {
        return origExists(p);
      } catch {
        return false;
      }
    });

    spyOn(fs, "readdirSync").mockImplementation((p: fs.PathLike, options?: unknown) => {
      const pathStr = String(p);
      if (!pathStr.startsWith(testDir)) {
        try {
          return origReaddir(
            p as string,
            options as { withFileTypes?: boolean },
          ) as unknown as fs.Dirent[];
        } catch {
          return [] as unknown as fs.Dirent[];
        }
      }
      const dirNames: string[] = [];
      for (const dir of mockDirs) {
        if (dir.startsWith(pathStr) && dir !== pathStr) {
          const sub = dir.slice(pathStr.length).replace(/^\/+/, "");
          const top = sub.split("/")[0];
          if (top && !dirNames.includes(top)) dirNames.push(top);
        }
      }
      const fileNames: string[] = [];
      for (const file of mockFiles.keys()) {
        if (file.startsWith(pathStr)) {
          const sub = file.slice(pathStr.length).replace(/^\/+/, "");
          const top = sub.split("/")[0];
          if (top && !dirNames.includes(top) && !fileNames.includes(top)) fileNames.push(top);
        }
      }
      const withFileTypes =
        typeof options === "object" &&
        options !== null &&
        Boolean((options as { withFileTypes?: boolean }).withFileTypes);

      if (withFileTypes) {
        const results = [
          ...dirNames.map((name) => ({ name, isDirectory: () => true, isFile: () => false })),
          ...fileNames.map((name) => ({ name, isDirectory: () => false, isFile: () => true })),
        ];
        return results as unknown as fs.Dirent[];
      }
      return [...dirNames, ...fileNames] as unknown as fs.Dirent[];
    });

    spyOn(fs, "readFileSync").mockImplementation((p: fs.PathOrFileDescriptor) => {
      const pathStr = String(p);
      const val = mockFiles.get(pathStr);
      if (val !== undefined) return val;
      try {
        return origRead(p as string, "utf-8");
      } catch {
        throw new Error(`ENOENT: no such file or directory, open '${pathStr}'`);
      }
    });

    spyOn(fs, "writeFileSync").mockImplementation(
      (p: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView) => {
        const pathStr = String(p);
        mockFiles.set(
          pathStr,
          typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"),
        );
      },
    );

    spyOn(fs, "mkdirSync").mockImplementation((p: fs.PathLike) => {
      mockDirs.add(String(p));
      return undefined as unknown as string;
    });
  });

  test("auditSkillCompliance passes on clean repository without incidents", () => {
    const cursor: AuditorCursor = {
      lastInspectedTimestamp: "1970-01-01T00:00:00.000Z",
      lastInspectedEventIndex: -1,
      lastAuditTimestamp: "1970-01-01T00:00:00.000Z",
    };

    const result = SkillAuditorEngine.auditSkillCompliance(testDir, {
      cursor,
    });

    expect(result.incidents.length).toBe(0);
    expect(result.defectsLogged).toBe(0);
    expect(result.compliant).toBe(true);
  });

  test("auditSkillCompliance scans capsule events and updates cursor", () => {
    const eventsDir = join(testDir, ".olt", "capsules", "run-1");
    mockDirs.add(eventsDir);
    mockFiles.set(join(eventsDir, "events.jsonl"), "");

    const cursor: AuditorCursor = {
      lastInspectedTimestamp: "1970-01-01T00:00:00.000Z",
      lastInspectedEventIndex: -1,
      lastAuditTimestamp: "1970-01-01T00:00:00.000Z",
    };

    const now = "2026-08-24T12:00:00.000Z";
    const result = SkillAuditorEngine.auditSkillCompliance(testDir, {
      cursor,
      capsuleRunRoot: eventsDir,
      now,
    });

    expect(result.cursor.lastInspectedTimestamp).toBe(now);
  });
});
