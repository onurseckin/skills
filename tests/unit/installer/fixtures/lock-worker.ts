import { acquireInstallerLock } from "../../../../orchestrating-long-tasks/scripts/src/installer/installer-lock.ts";

const parent = process.argv[2];
if (!parent) throw new Error("missing installer parent");
const lock = acquireInstallerLock(parent);
/**
 * The test kills this worker the instant it reads "locked", so the handler that turns SIGTERM into a
 * clean release has to be installed before that line is written. Announcing the lock first leaves a
 * window in which the signal meets the default disposition instead, and the worker dies on the
 * signal rather than releasing.
 */
process.on("SIGTERM", () => {
  lock.release();
  process.exit(0);
});
process.stdout.write("locked\n");
setInterval(() => undefined, 1_000);
