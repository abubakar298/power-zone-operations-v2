export interface User {
  id: string;
  email: string;
  displayName: string;
  role:
    | "Admin"
    | "Management"
    | "Employee"
    | "Coordinator"
    | "Operations"
    | "Inventory"
    | "Accounts";
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
  try {
    response = await fetch(`/api${path}`, {
      method: options ? "POST" : "GET",
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
    throw new ApiError(
      0,
      "Unable to connect. Check your connection and try again.",
    );
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.message ?? "The request could not be completed.",
    );
  return body as T;
}
