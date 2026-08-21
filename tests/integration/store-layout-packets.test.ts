import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initRun, loadRun } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { transact } from "../../orchestrating-long-tasks/scripts/src/store/transaction.ts";
import { verifyCapsuleLayout } from "../../orchestrating-long-tasks/scripts/src/store/layout-integrity.ts";
import { initializePlannerPacket } from "../../orchestrating-long-tasks/scripts/src/packets/planner-packet.ts";

const liveScriptsRoot = fileURLToPath(
  new URL("../../orchestrating-long-tasks/scripts", import.meta.url),
);
const roots: string[] = [];

// See tests/unit/packets/planner-packet.test.ts for why this is a frozen, test-owned copy rather
// than the live tree: copyPinnedRuntime's before/after re-hash otherwise races any concurrent
// write to the real `scripts` directory (another wave's agent, a background build).
let scriptsRoot: string;

beforeAll(() => {
  scriptsRoot = mkdtempSync(join(tmpdir(), "layout-packets-scripts-"));
  cpSync(liveScriptsRoot, scriptsRoot, { recursive: true });
});

afterAll(() => {
  rmSync(scriptsRoot, { recursive: true, force: true });
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function publishedRun(runId = "run-packet"): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "layout-packets-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  const run = initRun(repo, runId, new TextEncoder().encode("prompt"), "file", true, {
    runtimeSource: scriptsRoot,
  });
  await initializePlannerPacket(run, "planner");
  return run;
}

function codes(run: string): string[] {
  return verifyCapsuleLayout(run).map((issue) => issue.code);
}

describe("packet.md is checked against the chain-recorded packet_sha256", () => {
  test("a genuinely published packet raises nothing", async () => {
    const run = await publishedRun();

    expect(codes(run)).toEqual([]);
  });

  test("editing the markdown after publication is caught by its recorded digest", async () => {
    const run = await publishedRun("run-packet-content");
    const markdownPath = join(run, "packets", "planner-0", "packet.md");
    chmodSync(markdownPath, 0o644);
    writeFileSync(markdownPath, "tampered", "utf-8");

    expect(codes(run)).toContain("PACKET_CONTENT");
  });

  test("editing the metadata to disagree with the recorded packet is caught", async () => {
    const run = await publishedRun("run-packet-metadata");
    const metadataPath = join(run, "packets", "planner-0", "metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
    metadata.role = "implementer";
    chmodSync(metadataPath, 0o644);
    writeFileSync(metadataPath, JSON.stringify(metadata), "utf-8");

    expect(codes(run)).toContain("PACKET_METADATA");
  });

  test("a published packet whose bundle was deleted is caught, not silently tolerated", async () => {
    const run = await publishedRun("run-packet-deleted");
    chmodSync(join(run, "packets", "planner-0"), 0o755);
    rmSync(join(run, "packets", "planner-0"), { recursive: true, force: true });

    expect(codes(run)).toContain("PACKET_BUNDLE_MISSING");
  });

  test("a bundle directory state never registered is reported as undeclared", async () => {
    const run = await publishedRun("run-packet-undeclared");
    mkdirSync(join(run, "packets", "ghost"), { recursive: true });
    writeFileSync(join(run, "packets", "ghost", "packet.md"), "# ghost", "utf-8");
    writeFileSync(join(run, "packets", "ghost", "metadata.json"), "{}", "utf-8");

    expect(codes(run)).toContain("PACKET_UNDECLARED");
  });

  test("a bundle holding more than packet.md and metadata.json is reported", async () => {
    const run = await publishedRun("run-packet-shape");
    chmodSync(join(run, "packets", "planner-0"), 0o755);
    writeFileSync(join(run, "packets", "planner-0", "extra.txt"), "stray", "utf-8");

    expect(codes(run)).toContain("PACKET_BUNDLE_SHAPE");
  });

  test("a minimal state entry with no bundle paths makes no claim this check can verify", () => {
    // Fixtures that inject state directly (a common shortcut elsewhere in this suite) do not always
    // shape a packet the way `packetRecord()` does. Without markdown_path/metadata_path the record
    // is not a packet the harness ever published, so the check is silent rather than guessing a path.
    const root = mkdtempSync(join(tmpdir(), "layout-packets-"));
    roots.push(root);
    const repo = join(root, "repo");
    mkdirSync(repo);
    const run = initRun(
      repo,
      "run-packet-minimal",
      new TextEncoder().encode("prompt"),
      "file",
      true,
    );
    transact(run, "coordinator", "lifecycle-seeded", {}, (draft) => {
      draft.packets = { "P-1": { id: "P-1", status: "published", role: "planner" } };
    });

    expect(codes(run)).toEqual([]);
    expect(() => loadRun(run)).not.toThrow();
  });
});
