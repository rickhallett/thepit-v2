// Referral code generation — nanoid(8) with collision retry.
// Codes are stored on the users table (referral_code column, UNIQUE constraint).

import { eq, isNull, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { users } from "@/db/schema";

const CODE_LENGTH = 8;
const MAX_RETRIES = 4;

/** Postgres unique_violation error code. */
const PG_UNIQUE_VIOLATION = "23505";

/** Type guard for Postgres unique violation — checks error and its cause chain. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  // Direct code (pg driver error).
  if ("code" in err && (err as { code: unknown }).code === PG_UNIQUE_VIOLATION) {
    return true;
  }
  // Drizzle wraps the pg error in .cause.
  if ("cause" in err) {
    return isUniqueViolation((err as { cause: unknown }).cause);
  }
  return false;
}

/**
 * Returns the user's referral code, generating one if absent.
 * Requires the user row to exist (call ensureUserRecord first).
 * Retry loop handles the (unlikely) nanoid collision against the UNIQUE constraint.
 * Throws after MAX_RETRIES failed attempts.
 */
export async function ensureReferralCode(userId: string): Promise<string> {
  // Fast path: code already exists.
  const rows = await db
    .select({ referralCode: users.referralCode })
    .from(users)
    .where(eq(users.id, userId));

  if (rows.length === 0) {
    throw new Error(`User not found: ${userId}`);
  }

  if (rows[0].referralCode) return rows[0].referralCode;

  // Slow path: generate and persist.
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const code = nanoid(CODE_LENGTH);

    try {
      // Conditional UPDATE: only set if still NULL (race-safe for same user).
      // UNIQUE constraint on referral_code can throw 23505 if another user
      // already holds this code (cross-user collision).
      const result = await db
        .update(users)
        .set({ referralCode: code })
        .where(and(eq(users.id, userId), isNull(users.referralCode)))
        .returning({ referralCode: users.referralCode });

      // If we got a row back, the UPDATE succeeded.
      if (result.length > 0 && result[0].referralCode) {
        return result[0].referralCode;
      }

      // No row returned — another writer set this user's code first.
      // Re-read to return it.
      const recheckRows = await db
        .select({ referralCode: users.referralCode })
        .from(users)
        .where(eq(users.id, userId));

      if (recheckRows[0]?.referralCode) return recheckRows[0].referralCode;
    } catch (err: unknown) {
      // Cross-user collision: another user already has this nanoid code.
      // Retry with a new code.
      if (!isUniqueViolation(err)) throw err;
    }
  }

  throw new Error(
    `Failed to generate unique referral code after ${MAX_RETRIES} attempts`,
  );
}
