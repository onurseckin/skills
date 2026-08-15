import { acquireInstallerLock } from "../../../../orchestrating-long-tasks/scripts/src/installer/installer-lock.ts";

const parent = process.argv[2];
if (!parent) throw new Error("missing installer parent");
const lock = acquireInstallerLock(parent);
process.stdout.write("locked\n");
process.on("SIGTERM", () => {
  lock.release();
  process.exit(0);
});
setInterval(() => undefined, 1_000);
