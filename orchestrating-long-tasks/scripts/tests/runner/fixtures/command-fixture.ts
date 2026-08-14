import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [mode, arg] = process.argv.slice(2);

if (mode === "success") {
  console.log(arg ?? "ok");
} else if (mode === "test-failure") {
  console.error("AssertionError: tests failed");
  process.exitCode = 1;
} else if (mode === "network-once") {
  if (!arg) throw new Error("state path required");
  if (existsSync(arg)) console.log("recovered");
  else {
    writeFileSync(arg, "failed-once");
    console.error("connection reset by peer");
    process.exitCode = 75;
  }
} else if (mode === "network-always") {
  console.error("service unavailable");
  process.exitCode = 75;
} else if (mode === "host-interruption-once") {
  if (!arg) throw new Error("state path required");
  if (existsSync(arg)) console.log("resumed after host interruption");
  else {
    writeFileSync(arg, "interrupted-once");
    console.error("explicit host interruption");
    process.exitCode = 130;
  }
} else if (mode === "increment") {
  if (!arg) throw new Error("counter path required");
  const count = existsSync(arg) ? Number(readFileSync(arg, "utf8")) : 0;
  writeFileSync(arg, String(count + 1));
  console.log(`count=${count + 1}`);
} else if (mode === "flood") {
  process.stdout.write("x".repeat(Number(arg ?? "0")));
} else if (mode === "hard-then-transient-flood") {
  console.error("AssertionError: tests failed");
  console.error("service unavailable\n".repeat(1_000));
  process.exitCode = 1;
} else if (mode === "active") {
  for (let index = 0; index < 6; index += 1) {
    console.log(`tick-${index}`);
    await Bun.sleep(25);
  }
} else if (mode === "active-hang") {
  while (true) {
    console.log("still-active");
    await Bun.sleep(15);
  }
} else if (mode === "hang") {
  await new Promise(() => undefined);
} else if (mode === "ignore-term") {
  process.on("SIGTERM", () => console.error("ignored SIGTERM"));
  console.log("signal-handler-ready");
  await new Promise(() => undefined);
} else if (mode === "spawn-child") {
  if (!arg) throw new Error("pid path required");
  const child = Bun.spawn([process.execPath, import.meta.path, "hang"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  writeFileSync(arg, String(child.pid));
  await new Promise(() => undefined);
} else if (mode === "spawn-resistant-child") {
  if (!arg) throw new Error("pid path required");
  const child = Bun.spawn({
    cmd: [process.execPath, import.meta.path, "ignore-term"],
    stdout: "ignore",
    stderr: "ignore",
  });
  child.unref();
  writeFileSync(arg, String(child.pid));
  console.log("resistant-child-ready");
  await new Promise(() => undefined);
} else if (mode === "spawn-detached-pipe-holder") {
  if (!arg) throw new Error("pid path required");
  const child = Bun.spawn({
    cmd: [process.execPath, import.meta.path, "active-hang"],
    detached: true,
    stdout: "inherit",
    stderr: "inherit",
  });
  child.unref();
  writeFileSync(arg, String(child.pid));
  console.log("detached-child-ready");
  await Bun.sleep(60);
} else if (mode === "spawn-fast-detached-pipe-holder") {
  if (!arg) throw new Error("pid path required");
  const child = Bun.spawn({
    cmd: [process.execPath, import.meta.path, "active-hang"],
    detached: true,
    stdout: "inherit",
    stderr: "inherit",
  });
  child.unref();
  writeFileSync(arg, String(child.pid));
} else {
  console.error(`unknown mode: ${mode}`);
  process.exitCode = 2;
}
