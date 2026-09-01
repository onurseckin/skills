/**
 * @file atomic-dispatch-fixture.ts
 * In-Memory Virtual FS Fixture for Smart Tasks Atomic Dispatch Test Suite (Zero Disk I/O).
 */

import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

export interface AtomicDispatchTestSession {
  readonly testRoot: string;
  readonly feedbackFile: string;
  readonly taskQueueFile: string;
  readonly vfs: VirtualMemoryFS;
  readonly cleanup: () => void;
}

export function setupAtomicDispatchTestSession(): AtomicDispatchTestSession {
  const realCwd = process.cwd();
  const vfs = new VirtualMemoryFS();
  vfs.mkdirSync(realCwd, { recursive: true });
  vfs.chdir(realCwd);
  const session: VirtualFSSession = createVirtualFSSession(vfs);

  const testRoot = `${realCwd}/.olt/virtual-exec-atomic-dispatch`;
  const capsulesDir = join(testRoot, ".olt", "capsules");
  const feedbackFile = join(capsulesDir, "FEEDBACK_QUEUE.jsonl");
  const taskQueueFile = join(capsulesDir, "TASK_QUEUE.jsonl");

  vfs.mkdirSync(capsulesDir, { recursive: true });

  const cleanup = (): void => {
    session.cleanup();
  };

  return {
    testRoot,
    feedbackFile,
    taskQueueFile,
    vfs,
    cleanup,
  };
}
