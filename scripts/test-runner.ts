#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { acquireTestLock } from "./test-mutex.ts";

const rawArgs = process.argv.slice(2);

// Detect if broad scope or targeted
const isCoverage = rawArgs.includes("--coverage");
const fileTargets = rawArgs.filter((arg) => !arg.startsWith("-"));
const isBroadScope =
  fileTargets.length === 0 ||
  fileTargets.some(
    (t) => t === "tests" || t === "tests/unit" || t === "tests/" || t === "tests/unit/",
  );

const releaseLock = acquireTestLock(isBroadScope || isCoverage, rawArgs);

try {
  const defaultFlags = ["--timeout", "30000", "--parallel", "--no-isolate"];
  const finalArgs = ["test", ...defaultFlags, ...rawArgs];

  const result = spawnSync("bun", finalArgs, {
    stdio: "inherit",
    env: process.env,
  });

  process.exit(result.status ?? 0);
} finally {
  releaseLock();
}
