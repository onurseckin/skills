import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { registerAgentGrant } from "../../../olt/scripts/src/workflow/agents/grants.ts";

const [runRoot, barrier, label, agentId] = Bun.argv.slice(2);
if (!runRoot || !barrier || !label || !agentId) {
  throw new Error(
    "usage: agent-registration-racer.fixture.ts <run-root> <barrier> <label> <agent-id>",
  );
}

writeFileSync(join(barrier, `${label}.ready`), "ready", "utf8");
for (let attempt = 0; !existsSync(join(barrier, "start")); attempt += 1) {
  if (attempt >= 800) throw new Error("registration race start barrier timed out");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
}

try {
  registerAgentGrant({
    runRoot,
    agentId,
    role: "coordinator",
    parentAgentId: null,
    parentTaskId: null,
    host: "fixture",
    authority: { kind: "conditional_genesis" },
    maxAgents: 10,
    telemetry: {},
  });
  console.log("RESULT::" + JSON.stringify({ ok: true }));
} catch (error: unknown) {
  console.log(
    "RESULT::" +
      JSON.stringify({
        ok: false,
        ...(error instanceof HarnessError ? { code: error.code } : {}),
      }),
  );
}
