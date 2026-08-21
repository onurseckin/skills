import type { JsonObject } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { parseArguments } from "./arguments.ts";
import { assertFlags, type CommandContext } from "./options.ts";
import { assertGrantedCommand } from "../packets/command-authority.ts";
import { findCommand, flagShapes } from "./registry/index.ts";

export async function execute(
  argv: readonly string[],
  context: CommandContext = {},
): Promise<JsonObject> {
  const spec = findCommand(argv[0] ?? "");
  const parsed = parseArguments(argv, spec === undefined ? undefined : flagShapes(spec.flags));
  if (!spec) throw new HarnessError("INVALID_ARGUMENT", `unknown command: ${parsed.command}`);
  if (parsed.remainder.length && !spec.takesRemainder) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `command ${parsed.command} does not accept -- arguments`,
    );
  }
  assertFlags(
    parsed.flags,
    spec.flags.map((flag) => flag.name),
  );
  const missing = spec.flags.find(
    (flag) => flag.required && !Object.hasOwn(parsed.flags, flag.name),
  );
  if (missing) throw new HarnessError("INVALID_ARGUMENT", `--${missing.name} is required`);
  assertGrantedCommand(spec, parsed.flags);
  return (await spec.handler(parsed.flags, context, parsed.remainder)) as JsonObject;
}
