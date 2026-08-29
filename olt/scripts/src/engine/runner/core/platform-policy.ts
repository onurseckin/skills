import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index";
import { commandId } from "../models/command-id";

export interface ReservedCommandRoot {
  id: string;
  path: string;
}

export function assertRunnerPlatform(platform: string = process.platform): void {
  if (platform !== "darwin" && platform !== "linux") {
    throw new HarnessError(
      "UNSUPPORTED_PLATFORM",
      `monitored commands are unsupported on ${platform}; POSIX process groups are required`,
    );
  }
}

export async function reserveCommandRoot(
  parent: string,
  createId: () => string = commandId,
  maximumAttempts = 16,
): Promise<ReservedCommandRoot> {
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const id = createId();
    const path = join(parent, id);
    try {
      await mkdir(path, { recursive: false, mode: 0o700 });
      return { id, path };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new HarnessError("INVALID_STATE", "could not reserve a collision-free command ID");
}
