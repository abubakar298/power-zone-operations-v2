import {workflowFeedback} from './workflow-feedback.js';
import {departmentViewHeaders} from './department-view.js';
export interface User {
  id: string;
  email: string;
  displayName: string;
  restrictedCostAccess?: boolean;
  role:
    | "Admin"
    | "Management"
    | "Employee"
    | "Coordinator"
    | "Operations"
    | "Inventory"
    | "Accounts"
    | "Design";
}
export interface Session {
  user: User;
  csrfToken: string;
  expiresAt: string;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
// Real activity: a click, key press, scroll or touch in the last 10 seconds (Moaz, 24 Oct 2026). Requests made
// without one (timers, background refreshes) are marked, so they do not keep an idle session alive on the server.
let lastInput = Date.now();
if (typeof window !== "undefined")
  for (const name of ["pointerdown", "keydown", "wheel", "touchstart"])
    window.addEventListener(name, () => { lastInput = Date.now(); }, { capture: true, passive: true });
const background = () => Date.now() - lastInput > 10_000;

export async function api<T>(
  path: string,
  options?: { body: unknown; csrf?: string },
): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    response = await fetch(`/api${path}`, {
      method: options ? "POST" : "GET",
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
      headers: {...departmentViewHeaders(path),...(background() ? { "X-PZ-Background": "1" } : {}),...(options
        ? {
            "Content-Type": "application/json",
            ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}),
          }
        : {})},
      ...(options ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    clearTimeout(timeout);
    throw new ApiError(
      0,
      controller.signal.aborted
        ? "The request took too long. Refresh to check whether it completed before trying again."
        : "Unable to connect. Check your connection and try again.",
    );
  }
  try {
    if (response.status === 204) { if(options)workflowFeedback(path,options.body); return undefined as T; }
    let body: { message?: string; requestId?: string };
    try {
      body = await response.json();
    } catch {
      if (controller.signal.aborted)
        throw new ApiError(
          0,
          "The request took too long. Refresh to check whether it completed before trying again.",
        );
      throw new ApiError(
        response.status,
        "The server returned an unexpected response. Please refresh and try again.",
      );
    }
    // An ended session (idle or expired) takes the app back to the sign-in page, which says why.
    if (response.status === 401 && path !== "/auth/login" && typeof window !== "undefined")
      window.dispatchEvent(new CustomEvent("pz:session-ended", { detail: body.message ?? "" }));
    if (!response.ok)
      throw new ApiError(
        response.status,
        `${body.message ?? "The request could not be completed."}${body.requestId ? ` Reference: ${body.requestId}` : ""}`,
      );
    if(options)workflowFeedback(path,options.body);
    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}
