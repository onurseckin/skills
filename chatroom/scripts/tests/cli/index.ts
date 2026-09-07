export { guardsTestsSuite } from "./guards/index.ts";
export { lifecycleTestsSuite } from "./lifecycle/index.ts";

export const cliTestsSuite = [
  "ack",
  "daemon",
  "doctor",
  "init",
  "invite",
  "join",
  "read",
  "rooms",
  "say",
  "watch",
] as const;
