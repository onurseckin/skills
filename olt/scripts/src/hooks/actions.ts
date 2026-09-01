import type { HookDefinition, LifecycleEvent } from "./types.ts";

export async function executeWebhookAction(
  hook: HookDefinition,
  event: LifecycleEvent,
  payload?: Readonly<Record<string, unknown>> | undefined,
): Promise<{ success: boolean; output?: string | undefined; error?: string | undefined }> {
  if (hook.url === undefined || hook.url.trim().length === 0) {
    return { success: false, error: "Missing webhook URL in hook definition" };
  }

  try {
    const method = typeof hook.method === "string" ? hook.method : "POST";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...hook.headers,
    };

    const hasBody = method !== "GET";
    const body = hasBody
      ? JSON.stringify({
          event,
          payload: payload ?? {},
          timestamp: new Date().toISOString(),
        })
      : undefined;

    const timeout = hook.timeout_ms ?? 5000;
    const response = await fetch(hook.url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeout),
    });

    if (response.ok) {
      return { success: true, output: `HTTP ${response.status} ${response.statusText}` };
    }

    const text = await response.text().catch(() => "");
    return {
      success: false,
      error: `HTTP ${response.status}: ${text.length > 0 ? text : response.statusText}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function executeCustomAction(
  hook: HookDefinition,
  event: LifecycleEvent,
  payload?: Readonly<Record<string, unknown>> | undefined,
): Promise<{ success: boolean; output?: string | undefined; error?: string | undefined }> {
  if (typeof hook.handler !== "function") {
    return { success: false, error: "Missing custom hook handler function" };
  }

  try {
    const result = await hook.handler(event, payload);
    const output =
      typeof result === "string"
        ? result
        : result !== undefined && result !== null
          ? JSON.stringify(result)
          : undefined;
    return { success: true, output };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
