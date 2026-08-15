import type { JsonObject } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { parseArguments } from "./arguments.ts";
import type { CommandContext } from "./options.ts";
import {
  planInitCommand,
  planAddCommand,
  planCompileCommand,
  planStatusCommand,
} from "./commands/plan.ts";
import {
  queueNextCommand,
  queueListCommand,
  queuePopCommand,
} from "./commands/queue.ts";
import {
  taskClaimCommand,
  taskHeartbeatCommand,
  taskSubmitCommand,
  taskValidateStartCommand,
  taskReviewCommand,
  taskRejectCommand,
} from "./commands/task-ops.ts";
import { criticStartCommand, criticReviewCommand } from "./commands/critic-ops.ts";
import {
  runCompleteCommand,
  runStatusCommand,
  runExecCommand,
} from "./commands/run-ops.ts";
import {
  summaryExportCommand,
  summaryViewCommand,
} from "./commands/summary-ops.ts";

export async function execute(
  argv: readonly string[],
  context: CommandContext = {},
): Promise<JsonObject> {
  const parsed = parseArguments(argv);
  if (parsed.remainder.length && parsed.command !== "run:exec") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `command ${parsed.command} does not accept -- arguments`,
    );
  }

  switch (parsed.command) {
    case "plan:init":
      return (await planInitCommand(parsed.flags, context)) as JsonObject;
    case "plan:add":
      return planAddCommand(parsed.flags) as JsonObject;
    case "plan:compile":
      return planCompileCommand(parsed.flags) as JsonObject;
    case "plan:status":
      return planStatusCommand(parsed.flags) as JsonObject;

    case "queue:next":
      return queueNextCommand(parsed.flags) as JsonObject;
    case "queue:list":
      return queueListCommand(parsed.flags) as JsonObject;
    case "queue:pop":
      return (await queuePopCommand(parsed.flags)) as JsonObject;

    case "task:claim":
      return (await taskClaimCommand(parsed.flags)) as JsonObject;
    case "task:heartbeat":
      return taskHeartbeatCommand(parsed.flags) as JsonObject;
    case "task:submit":
      return (await taskSubmitCommand(parsed.flags)) as JsonObject;
    case "task:validate-start":
      return (await taskValidateStartCommand(parsed.flags)) as JsonObject;
    case "task:review":
      return (await taskReviewCommand(parsed.flags)) as JsonObject;
    case "task:reject":
      return (await taskRejectCommand(parsed.flags)) as JsonObject;

    case "critic:start":
      return (await criticStartCommand(parsed.flags)) as JsonObject;
    case "critic:review":
      return (await criticReviewCommand(parsed.flags)) as JsonObject;

    case "run:exec":
      return (await runExecCommand(parsed.flags, parsed.remainder)) as JsonObject;
    case "run:status":
      return runStatusCommand(parsed.flags) as JsonObject;
    case "run:complete":
      return runCompleteCommand(parsed.flags) as JsonObject;

    case "summary:export":
      return summaryExportCommand(parsed.flags) as JsonObject;
    case "summary:view":
      return summaryViewCommand(parsed.flags) as JsonObject;

    default:
      throw new HarnessError("INVALID_ARGUMENT", `unknown command: ${parsed.command}`);
  }
}
