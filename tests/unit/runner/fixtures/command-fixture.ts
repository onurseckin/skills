import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [mode, arg] = process.argv.slice(2);

/** Reads up to the first newline a piped child writes, for fixtures that must confirm a
 * grandchild reached a specific point before racing ahead on the assumption it will get there
 * "soon enough". */
async function readLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  while (!buffered.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();
  return buffered.split("\n")[0] ?? "";
}

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
    stdout: "pipe",
    stderr: "ignore",
  });
  child.unref();
  // The grandchild must confirm its SIGTERM handler is installed before this leader goes quiet
  // and starts the harness's idle clock toward the SIGTERM it will deliver. Ticking here — rather
  // than going straight to a blocking read — keeps this leader's own idle timer from lapsing while
  // the grandchild is still starting up, so a slow-to-schedule grandchild delays the moment the
  // countdown begins instead of racing it. Gambling that spawn-to-handler-registered always fits
  // one fixed budget is exactly the kind of assumption that holds on an idle machine and breaks
  // under CPU contention.
  let ready: string | undefined;
  let readyError: unknown;
  void readLine(child.stdout).then(
    (line) => {
      ready = line;
    },
    (error: unknown) => {
      readyError = error;
    },
  );
  while (ready === undefined && readyError === undefined) {
    console.log("waiting-for-resistant-child");
    await Bun.sleep(15);
  }
  if (readyError) throw readyError;
  if (ready !== "signal-handler-ready")
    throw new Error(`resistant child did not confirm its signal handler (saw "${ready}")`);
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
