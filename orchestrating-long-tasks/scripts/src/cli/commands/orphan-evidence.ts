import { readPlanObject } from "../../graph/read-plan.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { dispositionOrphanEvidence } from "../../workflow/orphan-evidence/disposition.ts";
import { actorFlag, assertFlags, textFlag, type Flags } from "../options.ts";

export async function dispositionOrphanEvidenceCommand(
  flags: Flags,
): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "actor", "disposition"]);
  const run = textFlag(flags, "run")!;
  const value = await readPlanObject(textFlag(flags, "disposition")!, "orphan disposition");
  const state = dispositionOrphanEvidence(workflowPort(run), actorFlag(flags), value);
  return {
    run_root: run,
    disposition: state.orphan_evidence_dispositions?.at(-1) ?? null,
  };
}
