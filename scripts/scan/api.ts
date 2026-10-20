import type { Deps, Problem } from "./shared.ts";

export type ApiResult = { ok: true; body: unknown } | { ok: false; issues: Problem[] };

/** One request to the points API; every failure becomes one-line problems that say what to do next. */
export async function callApi(deps: Deps, path: string, init: RequestInit | undefined, rerun: string): Promise<ApiResult> {
  const url = `${deps.apiUrl.replace(/\/+$/, "")}${path}`;
  let response: Response;
  try {
    response = await deps.fetchImpl(url, init);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      issues: [{ path: "network", message: `Couldn't reach ${deps.apiUrl} (${reason}); check the connection and run \`${rerun}\` again.` }],
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (response.ok) return { ok: true, body };

  const object = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (response.status === 429) {
    const wait = Number(response.headers.get("Retry-After"));
    const when = Number.isFinite(wait) && wait > 0 ? `wait ${wait} seconds, then` : "wait a few minutes, then";
    return { ok: false, issues: [{ path: "rate_limited", message: `The points API is rate limiting this address; ${when} run \`${rerun}\` again.` }] };
  }
  if (Array.isArray(object.issues) && object.issues.length > 0) {
    const issues = object.issues.flatMap((issue): Problem[] => {
      const i = issue as Record<string, unknown> | null;
      return i && typeof i.message === "string" ? [{ path: typeof i.path === "string" ? i.path : "$", message: i.message }] : [];
    });
    if (issues.length > 0) return { ok: false, issues };
  }
  if (typeof object.code === "string") {
    const message = typeof object.error === "string" ? object.error : `The points API refused the request (${object.code}); run \`${rerun}\` again.`;
    return { ok: false, issues: [{ path: object.code, message }] };
  }
  const status = response.status;
  if (status === 404) {
    return {
      ok: false,
      issues: [{ path: "http_404", message: `${deps.apiUrl} has no ${path} endpoint; community scans may not be live on this server yet. Check https://gleamwallet.app/scan.html, or set GLEAM_POINTS_API.` }],
    };
  }
  if (status >= 500) {
    return { ok: false, issues: [{ path: `http_${status}`, message: `The points API had a server error (${status}); wait a few minutes, then run \`${rerun}\` again.` }] };
  }
  return { ok: false, issues: [{ path: `http_${status}`, message: `The points API answered ${status} with no explanation; tell the user, since this is a bug to report.` }] };
}
