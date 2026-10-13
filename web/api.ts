import {workflowFeedback} from './workflow-feedback.js';
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
      headers: options
        ? {
            "Content-Type": "application/json",
            ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}),
          }
        : {},
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
