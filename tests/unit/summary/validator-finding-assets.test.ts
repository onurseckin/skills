import { describe, expect, test } from "bun:test";
import type { CommandRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/commands.ts";
import type { HarnessEvent } from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import type {
  CompletionReview,
  TaskRecord,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import {
  detectPlaywrightMetadata,
  mapFindingDetails,
  mapMediaAssets,
} from "../../../orchestrating-long-tasks/scripts/src/summary/asset-mapper.ts";
import { collectTimeline } from "../../../orchestrating-long-tasks/scripts/src/summary/timeline-collector.ts";

describe("Round 3: Validator Findings & Asset Pipeline", () => {
  describe("Rich Validator Finding Extraction", () => {
    test("extracts task findings with pushbackReason, opposedChanges, rejection rounds, targetFiles, and proofs", () => {
      const task: TaskRecord = {
        id: "T-auth",
        label: "Implement Authentication Service",
        status: "changes_requested",
        requirement_ids: ["REQ-AUTH-01"],
        write_scope: ["src/auth/service.ts", "src/auth/service.test.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 2,
        validation: {
          validator_id: "validator-sec-audit",
          token_digest: "digest-123",
          attempt: 2,
          started_at: "2026-08-15T19:00:00.000Z",
          deadline_at: "2026-08-15T19:15:00.000Z",
          verdict: "reject",
        },
        findings: [
          {
            id: "FINDING-AUTH-101",
            requirement_id: "REQ-AUTH-01",
            severity: "critical",
            observation: "JWT signature validation is bypassed when algorithm is set to none",
            remediation: "Enforce HS256 algorithm verification and reject none algorithm",
            revalidation: "Run security audit unit tests",
            status: "open",
            evidence: [
              {
                kind: "command",
                reference: "cmd-val-1",
                observation: "Failed test: jwt_none_algorithm_exploit",
              },
            ],
          },
          {
            id: "FINDING-AUTH-102",
            requirement_id: "REQ-AUTH-01",
            severity: "minor",
            observation: "Token expiration time should be configurable via environment variable",
            remediation: "Expose AUTH_TOKEN_EXPIRY in config",
            revalidation: "Check config loader",
            status: "resolved",
          },
        ],
      };

      const findings = mapFindingDetails(task);
      expect(findings).toHaveLength(2);

      const f1 = findings.find((f) => f.id === "FINDING-AUTH-101");
      expect(f1).toBeDefined();
      expect(f1?.requirementId).toBe("REQ-AUTH-01");
      expect(f1?.severity).toBe("critical");
      expect(f1?.observation).toContain("JWT signature validation is bypassed");
      expect(f1?.pushbackReason).toContain("JWT signature validation is bypassed");
      expect(f1?.opposedChanges).toBe("src/auth/service.ts, src/auth/service.test.ts");
      expect(f1?.remediation).toContain("Enforce HS256");
      expect(f1?.round).toBe(2);
      expect(f1?.rejectionRound).toBe(2);
      expect(f1?.validatorId).toBe("validator-sec-audit");
      expect(f1?.status).toBe("open");
      expect(f1?.revalidationProof?.method).toBe("Run security audit unit tests");
      expect(f1?.evidence?.[0]?.reference).toBe("cmd-val-1");

      const f2 = findings.find((f) => f.id === "FINDING-AUTH-102");
      expect(f2).toBeDefined();
      expect(f2?.severity).toBe("suggestion");
      expect(f2?.status).toBe("resolved");
    });

    test("extracts findings from completion review for completeness critic authority", () => {
      const completionReview: CompletionReview = {
        critic_id: "critic-authority-lead",
        packet_id: "packet-seal-01",
        packet_sha256: "sha-packet",
        graph_revision: 3,
        readiness_sha256: "sha-ready",
        repository_binding: {
          schema: "harness.repository-binding",
          version: 1,
          inspection_sha256: "insp",
          git_identity_sha256: "git",
          content_sha256: "content",
          file_count: 5,
          total_bytes: 2048,
        },
        status: "findings",
        unresolved_finding_ids: ["CRITIC-FINDING-01"],
        findings: [
          {
            id: "CRITIC-FINDING-01",
            requirement_id: "REQ-GLOBAL-01",
            severity: "critical",
            observation: "Missing integration test for multi-tenant isolation",
            remediation: "Add tests/integration/tenant-isolation.test.ts",
            revalidation: "Run tenant isolation integration suite",
            file_paths: ["tests/integration/tenant-isolation.test.ts"],
            evidence: [],
          },
          {
            id: "CRITIC-FINDING-02",
            requirement_id: "REQ-GLOBAL-02",
            severity: "important",
            observation: "Performance benchmark metrics missing in summary report",
            remediation: "Populate benchmark duration metrics",
            revalidation: "Inspect report artifact",
            evidence: [],
          },
        ],
        requirement_proofs: [],
        residual_risks: [],
        integrity_evidence: [],
        repository_command_ids: ["C-val-1"],
        checks: [],
        reviewed_at: "2026-08-15T19:30:00.000Z",
        review_sha256: "sha-rev",
      };

      const criticFindings = mapFindingDetails(undefined, { completionReview });
      expect(criticFindings).toHaveLength(2);

      const cf1 = criticFindings.find((f) => f.id === "CRITIC-FINDING-01");
      expect(cf1?.status).toBe("open");
      expect(cf1?.targetFiles).toEqual(["tests/integration/tenant-isolation.test.ts"]);
      expect(cf1?.opposedChanges).toBe("tests/integration/tenant-isolation.test.ts");
      expect(cf1?.fileRefs?.[0]?.mode).toBe("write");
      expect(cf1?.validatorId).toBe("critic-authority-lead");

      const cf2 = criticFindings.find((f) => f.id === "CRITIC-FINDING-02");
      expect(cf2?.status).toBe("resolved");
    });
  });

  describe("Validator Evidence & Screenshot Asset Pipeline", () => {
    test("crawls commands argv, stdout, stderr and maps rich MediaAsset objects with metadata", () => {
      const task: TaskRecord = {
        id: "T-ui-dashboard",
        label: "Build Telemetry Dashboard UI",
        status: "done",
        requirement_ids: ["REQ-UI-01"],
        write_scope: ["src/ui/dashboard.tsx"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
      };

      const cmdGate: CommandRecord = {
        id: "CMD-GATE-PLAYWRIGHT",
        argv: ["playwright", "test", "tests/ui/dashboard.spec.ts", "--reporter=line"],
        cwd: "/repo",
        cwd_relative: ".",
        repository_root: "/repo",
        status: "succeeded",
        task_id: "T-ui-dashboard",
        gate_id: "gate-ui-check",
        actor: "val",
        started_at: "2026-08-15T19:10:00.000Z",
        finished_at: "2026-08-15T19:10:05.000Z",
        exit_code: 0,
        signal: null,
        fingerprint: "fp-playwright",
        attempt_signing_public_key: "pk-val",
        record_path: "commands/CMD-GATE-PLAYWRIGHT/record.json",
        stdout: `
Running 3 tests using 1 worker
  ✓ [chromium] › dashboard.spec.ts:12:5 › render telemetry cards (450ms)
    Captured artifact: test-results/dashboard/telemetry_cards.png
    Captured layout audit: playwright-report/audit/layout_radial.svg
    Captured video recording: test-results/dashboard/run_recording.webm
    Generated document: evidence/audit_summary.pdf
    Detailed logs: logs/test_execution.log
        `,
      };

      const assets = mapMediaAssets(task, [cmdGate]);
      expect(assets.length).toBeGreaterThanOrEqual(5);

      const pngAsset = assets.find((a) => a.url.endsWith("telemetry_cards.png"));
      expect(pngAsset).toBeDefined();
      expect(pngAsset?.type).toBe("image");
      expect(pngAsset?.mimeType).toBe("image/png");
      expect(pngAsset?.title).toBe("Test Snapshot: telemetry_cards.png");
      expect(pngAsset?.description).toContain("Captured by validator");
      expect(pngAsset?.dimensions).toEqual({ width: 1280, height: 720 });
      expect(pngAsset?.metadata?.stage).toBe("validation");
      expect(pngAsset?.metadata?.commandId).toBe("CMD-GATE-PLAYWRIGHT");

      const svgAsset = assets.find((a) => a.url.endsWith("layout_radial.svg"));
      expect(svgAsset).toBeDefined();
      expect(svgAsset?.type).toBe("diagram");
      expect(svgAsset?.mimeType).toBe("image/svg+xml");
      expect(svgAsset?.title).toBe("Validator Layout Audit: layout_radial.svg");

      const webmAsset = assets.find((a) => a.url.endsWith("run_recording.webm"));
      expect(webmAsset).toBeDefined();
      expect(webmAsset?.type).toBe("video");
      expect(webmAsset?.mimeType).toBe("video/webm");

      const pdfAsset = assets.find((a) => a.url.endsWith("audit_summary.pdf"));
      expect(pdfAsset).toBeDefined();
      expect(pdfAsset?.type).toBe("document");
      expect(pdfAsset?.mimeType).toBe("application/pdf");

      const logAsset = assets.find((a) => a.url.endsWith("test_execution.log"));
      expect(logAsset).toBeDefined();
      expect(logAsset?.type).toBe("log");
      expect(logAsset?.mimeType).toBe("text/plain");

      const pwMeta = detectPlaywrightMetadata(task, [cmdGate], assets);
      expect(pwMeta).toBeDefined();
      expect(pwMeta?.browser).toBe("chromium");
      expect(pwMeta?.status).toBe("passed");
      expect(pwMeta?.testFile).toBe("tests/ui/dashboard.spec.ts");
      expect(pwMeta?.videos).toContain("test-results/dashboard/run_recording.webm");
      expect(pwMeta?.screenshots.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Timeline Collector Telemetry Fields", () => {
    test("collects timeline events and propagates pushback_reason, findings, validator_id, severity", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          kind: "task-validation-started",
          sequence: 1,
          timestamp: "2026-08-15T19:00:00.000Z",
          actor: "validator-bob",
          payload: {
            task_id: "T-10",
            validator_id: "validator-bob",
          },
        },
        {
          schema: "harness.event",
          version: 1,
          kind: "review-recorded",
          sequence: 2,
          timestamp: "2026-08-15T19:05:00.000Z",
          actor: "validator-bob",
          payload: {
            task_id: "T-10",
            verdict: "reject",
            round: 1,
            pushback_reason: "Failed contract invariant in schema validation",
            findings: 2,
            severity: "critical",
            validator_id: "validator-bob",
            duration_ms: 5000,
            tokens: 450,
          },
        },
        {
          schema: "harness.event",
          version: 1,
          kind: "critic-reviewed",
          sequence: 3,
          timestamp: "2026-08-15T19:15:00.000Z",
          actor: "critic-lead",
          payload: {
            verdict: "pass",
            critic_id: "critic-lead",
            findings: 0,
            tokens: 800,
          },
        },
      ];

      const timeline = collectTimeline(events, 1024);
      expect(timeline).toHaveLength(3);

      const valEvent = timeline[0];
      expect(valEvent.validator_id).toBe("validator-bob");

      const reviewEvent = timeline[1];
      expect(reviewEvent.phase).toBe("repair");
      expect(reviewEvent.pushback_reason).toBe("Failed contract invariant in schema validation");
      expect(reviewEvent.findings).toBe(2);
      expect(reviewEvent.severity).toBe("critical");
      expect(reviewEvent.round).toBe(1);
      expect(reviewEvent.duration_ms).toBe(5000);
      expect(reviewEvent.tokens).toBe(450);
      expect(reviewEvent.validator_id).toBe("validator-bob");

      const criticEvent = timeline[2];
      expect(criticEvent.phase).toBe("review");
      expect(criticEvent.validator_id).toBe("critic-lead");
      expect(criticEvent.findings).toBe(0);
    });
  });
});
