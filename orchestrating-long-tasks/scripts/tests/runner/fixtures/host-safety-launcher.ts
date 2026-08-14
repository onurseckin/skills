import { join } from "node:path";
import { sentinelCommandArgv } from "./sentinel-argv.ts";

const requested = sentinelCommandArgv(process.argv);
if (requested.length === 0) {
  console.error("usage: bun host-safety-launcher.ts -- bun test <focused files...>");
  process.exit(90);
}
const observer = join(import.meta.dir, "host-safety-observer.ts");
const child = Bun.spawn({
  cmd: [process.execPath, observer, "--", ...requested],
  cwd: process.cwd(),
  detached: true,
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env },
});
process.exit(await child.exited);
