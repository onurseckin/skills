import { describe, it, expect } from "bun:test";
import { MetaAuditorPolicy } from "../../../olt/scripts/src/engine/scheduler/meta-auditor-policy.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("MetaAuditorPolicy", () => {
  it("enforces mandatory meta-auditor when developing skills repo", () => {
    const activeAgents = [{ id: "mind-1", role: "mind" }];

    expect(() => {
      MetaAuditorPolicy.assertMetaAuditorRequired("/Users/foo/repos/skills", activeAgents as any);
    }).toThrow(HarnessError);
  });

  it("passes when meta-auditor is actively registered", () => {
    const activeAgents = [
      { id: "mind-1", role: "mind" },
      { id: "meta-auditor-1", role: "meta-auditor" },
    ];

    expect(() => {
      MetaAuditorPolicy.assertMetaAuditorRequired("/Users/foo/repos/skills", activeAgents as any);
    }).not.toThrow();
  });
});
