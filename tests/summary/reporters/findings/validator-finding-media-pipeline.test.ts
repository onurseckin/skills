import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { mapMediaAssets } from "../../../../olt/scripts/src/summary/assets/index.ts";
import { makeCommand, makeTask } from "../dag/graph-fixtures.ts";

const vfs = new Map<string, Buffer>();
const openFds = new Map<number, { path: string; content: Buffer }>();
let nextFd = 100;
let rootCounter = 0;
const spies: Array<{ mockRestore: () => void }> = [];

const origExists = fs.existsSync.bind(fs);
const origRead = fs.readFileSync.bind(fs);
const origOpen = fs.openSync.bind(fs);
const origFstat = fs.fstatSync.bind(fs);
const origReadSync = fs.readSync.bind(fs);
const origClose = fs.closeSync.bind(fs);

beforeEach(() => {
  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike): boolean => {
      const s = String(p).replace(/\/+$/, "");
      if (s.startsWith("/virtual/")) {
        return vfs.has(s);
      }
      return origExists(p);
    }),
    spyOn(fs, "readFileSync").mockImplementation(
      (p: fs.PathLike, opt?: unknown): string | Buffer => {
        const s = String(p).replace(/\/+$/, "");
        if (s.startsWith("/virtual/")) {
          const content = vfs.get(s);
          if (content === undefined) {
            throw new Error(`ENOENT: no such file or directory, open '${s}'`);
          }
          if (opt === "utf-8" || opt === "utf8" || (typeof opt === "object" && opt !== null)) {
            return content.toString("utf-8");
          }
          return content;
        }
        return origRead(p, opt as Parameters<typeof origRead>[1]) as string | Buffer;
      },
    ),
    spyOn(fs, "openSync").mockImplementation((p: fs.PathLike, flags: fs.OpenMode): number => {
      const s = String(p).replace(/\/+$/, "");
      if (s.startsWith("/virtual/")) {
        const content = vfs.get(s);
        if (content === undefined) {
          throw new Error(`ENOENT: no such file or directory, open '${s}'`);
        }
        const fd = ++nextFd;
        openFds.set(fd, { path: s, content });
        return fd;
      }
      return origOpen(p, flags);
    }),
    spyOn(fs, "fstatSync").mockImplementation((fd: number): fs.Stats => {
      const openFile = openFds.get(fd);
      if (openFile) {
        return {
          size: openFile.content.length,
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
        } as unknown as fs.Stats;
      }
      return origFstat(fd);
    }),
    spyOn(fs, "readSync").mockImplementation(
      (
        fd: number,
        buffer: NodeJS.ArrayBufferView,
        offset = 0,
        length = buffer.byteLength,
        position: fs.ReadPosition | null = 0,
      ): number => {
        const openFile = openFds.get(fd);
        if (openFile) {
          const content = openFile.content;
          const pos = typeof position === "number" ? position : 0;
          const slice = content.subarray(pos, pos + length);
          const targetBuf = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
          slice.copy(targetBuf, offset);
          return slice.length;
        }
        return origReadSync(fd, buffer, offset, length, position);
      },
    ),
    spyOn(fs, "closeSync").mockImplementation((fd: number): void => {
      if (openFds.has(fd)) {
        openFds.delete(fd);
        return;
      }
      origClose(fd);
    }),
  );
});

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  openFds.clear();
});

function runRootWithLog(contents: string): string {
  rootCounter += 1;
  const root = `/virtual/asset-mapper-${rootCounter}`;
  vfs.set(join(root, "commands", "CMD-GATE", "stdout.log"), Buffer.from(contents, "utf-8"));
  return root;
}

describe("media assets come from recorded bytes", () => {
  test("extracts paths from argv and from the log file the runner actually wrote", () => {
    const runRoot = runRootWithLog(
      [
        "Running 3 tests using 1 worker",
        "  Captured artifact: test-results/dashboard/telemetry_cards.png",
        "  Captured layout audit: playwright-report/audit/layout_radial.svg",
        "  Captured video recording: test-results/dashboard/run_recording.webm",
        "  Generated document: evidence/audit_summary.pdf",
      ].join("\n"),
    );
    const task = makeTask("T-ui-dashboard", { label: "Build Telemetry Dashboard UI" });
    const command = makeCommand("CMD-GATE", {
      argv: ["playwright", "test", "tests/ui/dashboard.spec.ts", "--reporter=line"],
      task_id: "T-ui-dashboard",
      gate_id: "gate-ui-check",
      actor: "val",
      logs: {
        stdout: { path: "commands/CMD-GATE/stdout.log", bytes: 256, sha256: "a" },
        stderr: { path: "commands/CMD-GATE/stderr.log", bytes: 0, sha256: "b" },
      },
    });

    const assets = mapMediaAssets(task, [command], { runRoot });
    const byUrl = new Map(assets.map((asset) => [asset.url, asset]));

    const png = byUrl.get("test-results/dashboard/telemetry_cards.png");
    expect(png?.type).toBe("image");
    expect(png?.mimeType).toBe("image/png");
    expect(png?.metadata?.stage).toBe("validation");
    expect(png?.metadata?.commandId).toBe("CMD-GATE");

    expect(byUrl.get("playwright-report/audit/layout_radial.svg")?.type).toBe("diagram");
    expect(byUrl.get("test-results/dashboard/run_recording.webm")?.type).toBe("video");
    expect(byUrl.get("evidence/audit_summary.pdf")?.type).toBe("document");
  });

  test("finds nothing in a log the run never wrote rather than inventing an asset", () => {
    const task = makeTask("T-no-logs");
    const command = makeCommand("CMD-MISSING", {
      task_id: "T-no-logs",
      argv: ["bun", "test"],
      logs: {
        stdout: { path: "commands/CMD-MISSING/stdout.log", bytes: 900, sha256: "a" },
        stderr: { path: "commands/CMD-MISSING/stderr.log", bytes: 0, sha256: "b" },
      },
    });

    expect(mapMediaAssets(task, [command], { runRoot: "/nonexistent-run-root" })).toEqual([]);
  });

  test("scopes finding screenshots to the validator and report screenshots to the implementer", () => {
    const task = makeTask("T-media-findings", {
      status: "changes_requested",
      repair_round: 1,
      report: { summary: "done", screenshots: ["evidence/report-shot.png"] },
      validations: [
        {
          validator_id: "val-visual-inspector",
          domain: "code-quality",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-15T19:00:00.000Z",
          deadline_at: "2026-08-15T19:10:00.000Z",
          verdict: "reject",
        },
      ],
      findings: [
        {
          id: "FINDING-THEME-01",
          requirement_id: "REQ-T-media-findings",
          severity: "critical",
          observation: "Dark mode background has low contrast",
          remediation: "Raise the contrast",
          revalidation: "Re-run the theme gate",
          status: "open",
          evidence: [],
          screenshots: ["evidence/theme-dark.png"],
        },
      ],
    });

    const implementer = mapMediaAssets(task, [], { scope: "implementer" });
    expect(implementer.map((asset) => asset.url)).toEqual(["evidence/report-shot.png"]);

    const validator = mapMediaAssets(task, [], { scope: "validator" });
    expect(validator).toHaveLength(1);
    expect(validator[0].id).toBe("FINDING-THEME-01-screenshot-1");
    expect(validator[0].url).toBe("evidence/theme-dark.png");
    expect(validator[0].author).toBe("val-visual-inspector");
    expect(validator[0].metadata?.findingId).toBe("FINDING-THEME-01");
  });

  test("a screenshot record with no type is typed from its own extension, not defaulted to image", () => {
    const task = makeTask("T-media-typed", {
      report: {
        summary: "done",
        screenshots: [{ url: "evidence/dashboard-recording.webm" }],
      },
      validations: [
        {
          validator_id: "val-visual-inspector",
          domain: "code-quality",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-15T19:00:00.000Z",
          deadline_at: "2026-08-15T19:10:00.000Z",
          verdict: "reject",
        },
      ],
    });

    const implementer = mapMediaAssets(task, [], { scope: "implementer" });
    expect(implementer).toHaveLength(1);
    expect(implementer[0].type).toBe("video");

    const validatorTask = makeTask("T-media-typed-val", {
      validations: [
        {
          validator_id: "val-visual-inspector",
          domain: "code-quality",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-15T19:00:00.000Z",
          deadline_at: "2026-08-15T19:10:00.000Z",
          verdict: "reject",
          screenshots: [{ url: "evidence/gate-audit.svg" }],
        },
      ],
    });
    const validatorAssets = mapMediaAssets(validatorTask, [], { scope: "validator" });
    expect(validatorAssets).toHaveLength(1);
    expect(validatorAssets[0].type).toBe("diagram");
  });
});
