import { registerSessionGrant } from "../../authority/session/index.ts";

export function registerInitialMindSessions(params: {
  mindId: string;
  actor?: string | undefined;
  runRoot: string;
  host: string;
}): void {
  const pid = typeof process !== "undefined" ? process.pid : 0;
  const ppid = typeof process !== "undefined" ? process.ppid : 0;

  try {
    registerSessionGrant({
      agentId: params.mindId,
      role: "mind",
      runRoot: params.runRoot,
      host: params.host,
      pid,
      ppid,
      bindProcessAncestry: false,
    });
  } catch {}

  if (params.actor === "owner" && params.actor !== params.mindId) {
    try {
      registerSessionGrant({
        agentId: "owner",
        role: "owner",
        runRoot: params.runRoot,
        host: params.host,
        pid,
        ppid,
        bindProcessAncestry: false,
      });
    } catch {}
  }
}
