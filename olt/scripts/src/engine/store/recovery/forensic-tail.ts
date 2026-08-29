import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fchmodSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fsyncDirectory } from "../../../core/durable-write.ts";

function copyFromOffset(source: number, destination: number, offset: number): void {
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = offset;
  while (true) {
    const count = readSync(source, buffer, 0, buffer.length, position);
    if (count === 0) break;
    let written = 0;
    while (written < count)
      written += writeSync(destination, buffer, written, count - written, null);
    position += count;
  }
}

export function quarantineAndTruncateTail(
  eventsPath: string,
  completeBytes: number,
  quarantineDirectory: string,
): string {
  const token = `${Date.now()}-${randomUUID()}`;
  const destination = join(quarantineDirectory, `recovery-torn-${token}.fragment`);
  const temporary = join(quarantineDirectory, `.recovery-torn-${token}.tmp`);
  let source: number | undefined;
  let output: number | undefined;
  try {
    source = openSync(eventsPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    if (!fstatSync(source).isFile()) throw new Error("events.jsonl is not a regular file");
    output = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    copyFromOffset(source, output, completeBytes);
    fchmodSync(output, 0o400);
    fsyncSync(output);
    closeSync(output);
    output = undefined;
    renameSync(temporary, destination);
    fsyncDirectory(quarantineDirectory);
  } catch (error) {
    if (output !== undefined) closeSync(output);
    if (existsSync(temporary)) rmSync(temporary);
    throw error;
  } finally {
    if (source !== undefined) closeSync(source);
  }

  const descriptor = openSync(eventsPath, constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!fstatSync(descriptor).isFile()) throw new Error("events.jsonl is not a regular file");
    ftruncateSync(descriptor, completeBytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  fsyncDirectory(dirname(eventsPath));
  return destination;
}
