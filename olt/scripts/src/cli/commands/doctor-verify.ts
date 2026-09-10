import { textFlag, type Flags } from "../index.ts";
import { doctorCommand } from "./doctor.ts";

export async function doctorVerifyCommand(flags: Flags): Promise<Record<string, unknown>> {
  textFlag(flags, "run");
  textFlag(flags, "source", false);
  textFlag(flags, "home", false);
  textFlag(flags, "clients", false);
  textFlag(flags, "actor", false);
  textFlag(flags, "role", false);

  return await doctorCommand(flags);
}
