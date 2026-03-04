// User mirroring — Clerk user ID → local DB record.
// First-write-wins: INSERT ON CONFLICT DO NOTHING (no profile updates on re-login).

import { db } from "@/db";
import { users } from "@/db/schema";

/** Profile fields passed from Clerk on first sign-in. */
export interface UserProfile {
  email: string;
  displayName: string | null;
  imageUrl: string | null;
}

/**
 * Inserts a user record if one does not already exist.
 * Idempotent — safe to call on every authenticated page load.
 * Does NOT update existing records (first write wins).
 */
export async function ensureUserRecord(
  clerkUserId: string,
  profile: UserProfile,
): Promise<void> {
  await db
    .insert(users)
    .values({
      id: clerkUserId,
      email: profile.email,
      displayName: profile.displayName,
      imageUrl: profile.imageUrl,
    })
    .onConflictDoNothing({ target: users.id });
}
