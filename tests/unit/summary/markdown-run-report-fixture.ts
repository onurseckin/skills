import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { generateSummarySuite } from "../../../orchestrating-long-tasks/scripts/src/summary/generate-summary.ts";

type FlagValue = readonly string[] | string;

/** Flattens a flag map into argv so a whole lifecycle reads as commands rather than as arrays. */
async function cli(
  command: string,
  flags: Record<string, FlagValue>,
  child: readonly string[] = [],
): Promise<Record<string, unknown>> {
  const argv = [command];
  for (const [name, value] of Object.entries(flags)) {
    for (const entry of typeof value === "string" ? [value] : value) argv.push(`--${name}`, entry);
  }
  if (child.length > 0) argv.push("--", ...child);
  return execute(argv);
}

function token(result: Record<string, unknown>): string {
  const value = result.token;
  if (typeof value !== "string") throw new Error(`${String(result.markdown)} returned no token`);
  return value;
}

function commandId(result: Record<string, unknown>): string {
  const value = result.command_id;
  if (typeof value !== "string") throw new Error("run:exec returned no command id");
  return value;
}

function firstFindingId(result: Record<string, unknown>): string {
  const ids = result.finding_ids;
  const first = Array.isArray(ids) ? ids[0] : undefined;
  if (typeof first !== "string") throw new Error("no finding id was returned");
  return first;
}

export interface BuiltRun {
  repo: string;
  run: string;
  markdown: string;
  failingExitCode: unknown;
}

/**
 * One capsule driven entirely through the CLI, exercising every feature the report has to carry:
 * an enhanced plan, two tasks in one wave and a third behind a dependency, a branch with two
 * sub-agents, a probe, a defect pushback with a repair round, gate evidence, a command that exits
 * non-zero, host-reported agent telemetry, a critic verdict and a sealed completion.
 */
export async function buildRunReportCapsule(): Promise<BuiltRun> {
  const repo = mkdtempSync(join(tmpdir(), "harness-b6-"));
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "gate.ts"), "console.log('gate ok');\n");
  writeFileSync(join(repo, ".gitignore"), ".capsules/\n");
  writeFileSync(
    join(repo, "prompt.txt"),
    "Build the alpha subsystem.\nBuild the beta subsystem.\nWire gamma onto alpha.\n",
  );
  Bun.spawnSync(["git", "init", "-q"], { cwd: repo });

  const init = await cli("plan:init", {
    repo,
    run: "b6-run",
    "prompt-file": join(repo, "prompt.txt"),
  });
  const run = init.run_root as string;

  await cli("plan:enhance", {
    run,
    actor: "planner-1",
    summary: "Three subsystems, two of them independent",
    observation: "src has no tests yet",
    todo: "Add parser tests",
    risk: "The lexer rewrite may regress",
    "open-question": "Which grammar version applies",
    source: "src/alpha.ts",
  });
  const declarations: readonly (readonly [string, string, string, string, string | null])[] = [
    ["task-alpha", "Alpha subsystem", "src/alpha", "1", null],
    ["task-beta", "Beta subsystem", "src/beta", "2", null],
    ["task-gamma", "Gamma wiring", "src/gamma", "3", "task-alpha"],
  ];
  for (const [id, label, scope, lines, deps] of declarations) {
    await cli("plan:add", {
      run,
      id,
      label,
      scope,
      gate: "bun gate.ts",
      actor: "planner-1",
      "requirement-lines": lines,
      ...(deps === null ? {} : { deps }),
    });
  }
  await cli("plan:compile", {
    run,
    actor: "planner-1",
    "completion-gate": "bun gate.ts",
  });

  await cli("agent:register", {
    run,
    agent: "coordinator-1",
    role: "coordinator",
    host: "claude-code",
  });
  await cli("agent:register", {
    run,
    agent: "worker-alpha",
    role: "implementer",
    host: "claude-code",
    "parent-agent": "coordinator-1",
    "parent-task": "task-alpha",
    model: "test-model-l",
    "model-tier": "l",
    "thinking-level": "high",
    tool: "Read",
  });
  await cli("agent:report", {
    run,
    agent: "worker-alpha",
    tool: "Bash",
    "tokens-in": "1200",
    "tokens-out": "340",
  });
  for (const [agent, task] of [
    ["worker-beta", "task-beta"],
    ["validator-1", "task-alpha"],
    ["validator-2", "task-beta"],
    ["worker-gamma", "task-gamma"],
  ] as const) {
    await cli("agent:register", {
      run,
      agent,
      role: agent.startsWith("validator") ? "validator" : "implementer",
      host: "claude-code",
      "parent-agent": "coordinator-1",
      "parent-task": task,
    });
  }

  const alphaToken = token(
    await cli("task:claim", {
      run,
      task: "task-alpha",
      agent: "worker-alpha",
      role: "implementer",
    }),
  );
  const betaToken = token(
    await cli("task:claim", { run, task: "task-beta", agent: "worker-beta", role: "implementer" }),
  );

  const branch = await cli("branch:open", {
    run,
    "parent-task": "task-alpha",
    agent: "worker-alpha",
    token: alphaToken,
    reason: "the lexer and the parser had to move together",
    repo,
    "sub-task": ["S-lexer", "S-parser"],
    "sub-label": ["S-lexer=Rewrite the lexer", "S-parser=Rewrite the parser"],
    "sub-scope": ["S-lexer=src/alpha/lexer", "S-parser=src/alpha/parser"],
  });
  const branchId = branch.branch_id as string;
  for (const [agent, subTask] of [
    ["sub-lexer", "S-lexer"],
    ["sub-parser", "S-parser"],
  ] as const) {
    await cli("agent:register", {
      run,
      agent,
      role: "sub-implementer",
      host: "claude-code",
      "parent-agent": "worker-alpha",
      "parent-task": subTask,
    });
    const claimed = await cli("branch:claim", {
      run,
      branch: branchId,
      "sub-task": subTask,
      agent,
      role: "sub-implementer",
      repo,
    });
    await cli("branch:submit", {
      run,
      branch: branchId,
      "sub-task": subTask,
      agent,
      token: token(claimed),
      summary: `${subTask} finished`,
    });
    await cli("agent:release", { run, agent, reason: "sub-task submitted" });
  }
  await cli("branch:collect", {
    run,
    branch: branchId,
    agent: "worker-alpha",
    token: alphaToken,
    summary: "lexer and parser landed together",
    repo,
  });

  const alphaWork = commandId(
    await cli("run:exec", { run, task: "task-alpha", actor: "worker-alpha", cwd: repo }, [
      "bun",
      "-e",
      "console.log('alpha work')",
    ]),
  );
  const failing = await cli("run:exec", { run, actor: "coordinator-1", cwd: repo }, [
    "bun",
    "-e",
    "process.exit(3)",
  ]);

  await cli("task:submit", {
    run,
    task: "task-alpha",
    agent: "worker-alpha",
    token: alphaToken,
    summary: "Alpha complete",
    "files-changed": "src/alpha/parser.ts",
    evidence: alphaWork,
  });
  const alphaValidation = token(
    await cli("task:validate-start", { run, task: "task-alpha", validator: "validator-1" }),
  );
  const alphaGate = commandId(
    await cli(
      "run:exec",
      { run, task: "task-alpha", gate: "gate-alpha", actor: "validator-1", cwd: repo },
      ["bun", "gate.ts"],
    ),
  );
  const alphaProbe = await cli("task:probe", {
    run,
    task: "task-alpha",
    validator: "validator-1",
    token: alphaValidation,
    demand: "Prove the lexer rejects an empty payload",
  });
  await cli("task:review", {
    run,
    task: "task-alpha",
    validator: "validator-1",
    token: alphaValidation,
    evidence: alphaGate,
    resolve: `${firstFindingId(alphaProbe)}=${alphaGate}`,
    status: "pass",
    summary: "Alpha proven",
  });

  const betaWork = commandId(
    await cli("run:exec", { run, task: "task-beta", actor: "worker-beta", cwd: repo }, [
      "bun",
      "-e",
      "console.log('beta work')",
    ]),
  );
  await cli("task:submit", {
    run,
    task: "task-beta",
    agent: "worker-beta",
    token: betaToken,
    summary: "Beta complete",
    "files-changed": "src/beta/index.ts",
    evidence: betaWork,
  });
  const betaValidation = token(
    await cli("task:validate-start", { run, task: "task-beta", validator: "validator-1" }),
  );
  const betaGate = commandId(
    await cli(
      "run:exec",
      { run, task: "task-beta", gate: "gate-beta", actor: "validator-1", cwd: repo },
      ["bun", "gate.ts"],
    ),
  );
  const rejection = await cli("task:reject", {
    run,
    task: "task-beta",
    validator: "validator-1",
    token: betaValidation,
    reason: "the beta entry point never validates its input",
    severity: "important",
    remediation: "validate the payload before the insert",
    evidence: betaGate,
  });
  const repairToken = token(
    await cli("task:claim", { run, task: "task-beta", agent: "worker-beta", role: "repairer" }),
  );
  await cli("task:submit", {
    run,
    task: "task-beta",
    agent: "worker-beta",
    token: repairToken,
    summary: "Beta validates its input now",
    "files-changed": "src/beta/index.ts",
    evidence: betaWork,
  });
  const betaRevalidation = token(
    await cli("task:validate-start", { run, task: "task-beta", validator: "validator-2" }),
  );
  const betaGateAgain = commandId(
    await cli(
      "run:exec",
      { run, task: "task-beta", gate: "gate-beta", actor: "validator-2", cwd: repo },
      ["bun", "gate.ts"],
    ),
  );
  const betaProbe = await cli("task:probe", {
    run,
    task: "task-beta",
    validator: "validator-2",
    token: betaRevalidation,
    demand: "Prove the insert rejects an empty payload",
  });
  await cli("task:review", {
    run,
    task: "task-beta",
    validator: "validator-2",
    token: betaRevalidation,
    evidence: betaGateAgain,
    resolve: [
      `${firstFindingId(betaProbe)}=${betaGateAgain}`,
      `${rejection.finding_id as string}=${betaGateAgain}`,
    ],
    status: "pass",
    summary: "Beta proven after repair",
  });

  const gammaToken = token(
    await cli("task:claim", {
      run,
      task: "task-gamma",
      agent: "worker-gamma",
      role: "implementer",
    }),
  );
  const gammaWork = commandId(
    await cli("run:exec", { run, task: "task-gamma", actor: "worker-gamma", cwd: repo }, [
      "bun",
      "-e",
      "console.log('gamma work')",
    ]),
  );
  await cli("task:submit", {
    run,
    task: "task-gamma",
    agent: "worker-gamma",
    token: gammaToken,
    summary: "Gamma wired",
    "files-changed": "src/gamma/index.ts",
    evidence: gammaWork,
  });
  const gammaValidation = token(
    await cli("task:validate-start", { run, task: "task-gamma", validator: "validator-1" }),
  );
  const gammaGate = commandId(
    await cli(
      "run:exec",
      { run, task: "task-gamma", gate: "gate-gamma", actor: "validator-1", cwd: repo },
      ["bun", "gate.ts"],
    ),
  );
  const gammaProbe = await cli("task:probe", {
    run,
    task: "task-gamma",
    validator: "validator-1",
    token: gammaValidation,
    demand: "Prove gamma fails when alpha is reverted",
  });
  await cli("task:review", {
    run,
    task: "task-gamma",
    validator: "validator-1",
    token: gammaValidation,
    evidence: gammaGate,
    resolve: `${firstFindingId(gammaProbe)}=${gammaGate}`,
    status: "pass",
    summary: "Gamma proven",
  });
  await cli("run:exec", { run, gate: "gate-run-completion", actor: "coordinator-1", cwd: repo }, [
    "bun",
    "gate.ts",
  ]);

  await cli("agent:register", {
    run,
    agent: "critic-1",
    role: "completeness-critic",
    host: "claude-code",
    "parent-agent": "coordinator-1",
  });
  const criticToken = token(await cli("critic:start", { run, critic: "critic-1" }));
  const criticGate = commandId(
    await cli("run:exec", { run, actor: "critic-1", cwd: repo }, ["bun", "gate.ts"]),
  );
  const proofs = JSON.stringify(
    ["req-alpha", "req-beta", "req-gamma"].map((requirementId) => ({
      requirement_id: requirementId,
      status: "satisfied",
      evidence: [
        {
          kind: "command",
          reference: criticGate,
          observation: `${requirementId} proven by the critic's own gate run`,
        },
      ],
    })),
  );
  await cli("critic:review", {
    run,
    critic: "critic-1",
    token: criticToken,
    decision: "approve",
    summary: "Every requirement is proven by a recorded gate",
    proofs,
  });
  await cli("run:complete", { run, actor: "coordinator-1" });

  const suite = generateSummarySuite({ capsulePath: run, writeToDisk: false });
  return { repo, run, markdown: suite.markdown, failingExitCode: failing.exit_code };
}
