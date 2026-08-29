import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { parseRawFindings } from "../../../olt/scripts/src/workflow/completion/parse-raw-findings.ts";
import { observeCapsuleIntegrity } from "../../../olt/scripts/src/workflow/completion/integrity-evidence.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/load.ts";
import { integrityGateIssues } from "./integrity-review-fixture.ts";

const complete = {
  id: "F-1",
  requirement_id: "R-1",
  severity: "critical",
  observation: "The retry path never resets the backoff timer",
  remediation: "Reset the timer when the retry succeeds",
  revalidation: "bun test tests/unit/retry.test.ts",
};

function withoutField(field: string): string {
  const record: Record<string, unknown> = { ...complete };
  delete record[field];
  return JSON.stringify([record]);
}

function withRun<T>(name: string, body: (runRoot: string) => T): T {
  const repo = mkdtempSync(join(tmpdir(), `${name}-`));
  try {
    return body(initRun(repo, name, new TextEncoder().encode("do the work"), "file", true));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

describe("critic findings are the critic's own words", () => {
  test("a complete finding round-trips untouched", () => {
    const [finding] = parseRawFindings(JSON.stringify([complete]), undefined);
    expect(finding?.id).toBe("F-1");
    expect(finding?.requirement_id).toBe("R-1");
    expect(finding?.severity).toBe("critical");
    expect(finding?.remediation).toBe("Reset the timer when the retry succeeds");
    expect(finding?.revalidation).toBe("bun test tests/unit/retry.test.ts");
  });

  test.each(["id", "requirement_id", "severity", "observation", "remediation", "revalidation"])(
    "a finding missing %s is refused rather than filled in",
    (field) => {
      expect(() => parseRawFindings(withoutField(field), undefined)).toThrow(HarnessError);
    },
  );

  test("a blank observation is refused", () => {
    expect(() =>
      parseRawFindings(JSON.stringify([{ ...complete, observation: "  " }]), undefined),
    ).toThrow(HarnessError);
  });

  test("an unrecognised severity is refused rather than downgraded to important", () => {
    expect(() =>
      parseRawFindings(JSON.stringify([{ ...complete, severity: "blocker" }]), undefined),
    ).toThrow("severity critical, important or minor");
  });

  test("unparseable findings text is an argument error, not a synthesized finding", () => {
    expect(() => parseRawFindings("the retry path is broken", undefined)).toThrow(
      "findings payload is not valid JSON",
    );
  });

  test("evidence the critic cited is carried through verbatim", () => {
    const cited = [{ kind: "command", reference: "cmd-7", observation: "the gate failed here" }];
    const [finding] = parseRawFindings(
      JSON.stringify([{ ...complete, evidence: cited }]),
      undefined,
    );
    expect(finding?.evidence).toEqual(cited);
  });

  test("a finding citing no evidence is labelled the critic's own assertion", () => {
    const [finding] = parseRawFindings(JSON.stringify([complete]), undefined);
    expect(finding?.evidence).toEqual([
      {
        kind: "critic_assertion",
        evidence_class: "agent_reported",
        observation: complete.observation,
      },
    ]);
  });

  test("no findings payload yields no findings", () => {
    expect(parseRawFindings(undefined, undefined)).toEqual([]);
    expect(parseRawFindings("   ", undefined)).toEqual([]);
  });
});

describe("capsule integrity evidence is measured", () => {
  test("a clean capsule is observed as passed with no issues", () => {
    withRun("integrity-clean", (runRoot) => {
      const evidence = observeCapsuleIntegrity(runRoot, loadRun(runRoot).state.event_head);
      expect(evidence.status).toBe("passed");
      expect(evidence.issues).toEqual([]);
      expect(evidence.evidence_class).toBe("harness_observed");
      expect(evidence.event_head).toBe(loadRun(runRoot).state.event_head);
    });
  });

  test("a tampered event log is observed as failed and blocks completion", () => {
    withRun("integrity-tampered", (runRoot) => {
      const eventsPath = join(runRoot, "events.jsonl");
      const head = loadRun(runRoot).state.event_head;
      appendFileSync(eventsPath, "this line was never appended by the harness\n", "utf-8");

      const evidence = observeCapsuleIntegrity(runRoot, head);
      expect(evidence.status).toBe("failed");
      expect(evidence.issues.length).toBeGreaterThan(0);

      expect(integrityGateIssues(evidence)).toContain("completion integrity evidence is not clean");
    });
  });
});
