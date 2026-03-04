// Auth helpers for route handlers.
// Thin wrappers over Clerk's server-side auth.

import { auth } from "@clerk/nextjs/server";

/** Typed auth error — route handlers should catch and map to 401. */
export class AuthenticationError extends Error {
  readonly status = 401 as const;

  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/** Returns Clerk user ID or null if not authenticated. */
export async function getAuthUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}

/** Returns Clerk user ID. Throws AuthenticationError if not authenticated. */
export async function requireAuth(): Promise<string> {
  const userId = await getAuthUserId();
  if (!userId) {
    throw new AuthenticationError();
  }
  return userId;
}
