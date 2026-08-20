import { setupCompiledRun } from "./tests/unit/cli/task-ops-fixture.ts";
import { loadRun } from "./orchestrating-long-tasks/scripts/src/store/index.ts";
const roots: string[] = [];
const { run } = await setupCompiledRun("probe-req", roots);
console.log(JSON.stringify(loadRun(run).state.requirements, null, 2));
