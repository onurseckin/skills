import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

export function readRegularFileNoFollow(path: string): Uint8Array {
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!fstatSync(descriptor).isFile()) throw new Error(`${path} is not a regular file`);
    return new Uint8Array(readFileSync(descriptor));
  } finally {
    closeSync(descriptor);
  }
}
