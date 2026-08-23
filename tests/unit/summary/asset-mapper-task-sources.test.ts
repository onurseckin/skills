import { describe, expect, test } from "bun:test";
import {
  collectCriticEvidenceAssets,
  collectReportAssets,
} from "../../../olt/scripts/src/summary/asset-mapper-task-sources.ts";
import type { CompletionReview } from "../../../olt/scripts/src/workflow/completion/types.ts";
import type { MediaAsset } from "../../../olt/scripts/src/summary/types.ts";
import { makeTask } from "./graph-fixtures.ts";

function collect<T>(fn: (add: (asset: MediaAsset) => void, nextIndex: () => number) => T): {
  assets: MediaAsset[];
  result: T;
} {
  const assets: MediaAsset[] = [];
  const result = fn(
    (asset) => assets.push(asset),
    () => assets.length + 1,
  );
  return { assets, result };
}

describe("collectReportAssets: report.media_assets", () => {
  test("reads an explicitly recorded media asset, keeping every field the report itself gave it", () => {
    const task = makeTask("T-1", {
      report: {
        media_assets: [
          {
            id: "custom-id",
            type: "diagram",
            url: "evidence/architecture.svg",
            title: "Architecture Diagram",
            description: "The updated service boundary",
            timestamp: "2026-08-19T00:00:00.000Z",
            mimeType: "image/svg+xml",
            sizeBytes: 4096,
            dimensions: { width: 800, height: 600 },
            metadata: { note: "hand-drawn" },
          },
        ],
      },
      lease: {
        agent_id: "worker-1",
        role: "implementer",
        attempt: 1,
        token_digest: "tok",
        issued_at: "2026-08-14T20:00:00.000Z",
        expires_at: "2026-08-14T21:00:00.000Z",
        heartbeat_at: "2026-08-14T20:00:00.000Z",
        duration_seconds: 3600,
        write_scope: ["src/T-1.ts"],
        resource_scope: [],
      },
    });

    const { assets } = collect((add, nextIndex) => collectReportAssets(task, add, nextIndex));
    expect(assets).toHaveLength(1);
    expect(assets[0]).toEqual({
      id: "custom-id",
      type: "diagram",
      url: "evidence/architecture.svg",
      title: "Architecture Diagram",
      description: "The updated service boundary",
      timestamp: "2026-08-19T00:00:00.000Z",
      mimeType: "image/svg+xml",
      sizeBytes: 4096,
      dimensions: { width: 800, height: 600 },
      author: "worker-1",
      metadata: { note: "hand-drawn" },
    });
  });

  test("infers whatever the entry itself did not state, and skips an entry with no url", () => {
    const task = makeTask("T-1", {
      report: {
        media_assets: [
          { url: "evidence/shot.png" },
          { note: "no url at all" },
          null,
          "not-an-object",
        ],
      },
    });

    const { assets } = collect((add, nextIndex) => collectReportAssets(task, add, nextIndex));
    expect(assets).toHaveLength(1);
    expect(assets[0]?.id).toBe("asset-T-1-1");
    expect(assets[0]?.type).toBe("image");
    expect(assets[0]?.title).toBe("Test Snapshot: shot.png");
    expect(assets[0]?.author).toBeUndefined();
  });

  test("continues numbering media_assets and screenshots off the same shared index", () => {
    const task = makeTask("T-1", {
      report: {
        media_assets: [{ url: "evidence/one.png" }],
        screenshots: ["evidence/two.png"],
      },
    });

    const { assets } = collect((add, nextIndex) => collectReportAssets(task, add, nextIndex));
    expect(assets.map((asset) => asset.id)).toEqual(["asset-T-1-1", "asset-T-1-2"]);
  });
});

describe("collectCriticEvidenceAssets", () => {
  function review(overrides: Partial<CompletionReview> = {}): CompletionReview {
    return {
      critic_id: "critic-1",
      packet_id: "packet-1",
      graph_revision: 1,
      readiness_sha256: "r".repeat(64),
      repository_binding: {
        commit: "c".repeat(40),
      } as unknown as CompletionReview["repository_binding"],
      summary: "Reviewed",
      status: "clean",
      unresolved_finding_ids: [],
      findings: [],
      requirement_proofs: [],
      residual_risks: [],
      integrity_evidence: [],
      repository_command_ids: [],
      checks: [],
      reviewed_at: "2026-08-19T00:00:00.000Z",
      review_sha256: "s".repeat(64),
      ...overrides,
    };
  }

  test("reads a path field directly, and falls back to reference when there is no path", () => {
    const { assets } = collect((add, nextIndex) =>
      collectCriticEvidenceAssets(
        review({
          integrity_evidence: [
            { path: "evidence/critic-seal.png" },
            { reference: "evidence/critic-log.log" },
            // Neither field, or an extension the critic pipeline does not treat as evidence.
            { command_id: "cmd-1" },
            { path: "evidence/notes.txt" },
          ],
        }),
        add,
        nextIndex,
      ),
    );

    expect(assets.map((asset) => asset.url)).toEqual([
      "evidence/critic-seal.png",
      "evidence/critic-log.log",
    ]);
    expect(assets[0]?.author).toBe("critic-1");
    expect(assets[0]?.metadata).toEqual({ stage: "critic" });
  });
});
