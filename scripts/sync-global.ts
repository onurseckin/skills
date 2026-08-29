export * from "./sync/index";
import { runSync } from "./sync/index";

if (import.meta.main) {
  const allowDirty = process.argv.slice(2).includes("--allow-dirty");
  await runSync({ allowDirty });
}
