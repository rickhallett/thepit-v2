// Credit balance operations — account creation, balance queries, atomic deltas.
// All amounts are in micro-credits (10000 micro = 100 display credits).

import { db } from "@/db";
import { credits, creditTransactions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { CreditSource } from "./types";

const DEFAULT_BALANCE_MICRO = 10000; // 100 credits

/**
 * Creates a credit account for a user with the default starting balance.
 * Idempotent via ON CONFLICT DO NOTHING — safe to call multiple times.
 * Also logs a signup transaction (idempotent via reference_id check).
 */
export async function ensureCreditAccount(userId: string): Promise<void> {
  // Insert credit account — idempotent
  await db
    .insert(credits)
    .values({
      userId,
      balanceMicro: DEFAULT_BALANCE_MICRO,
    })
    .onConflictDoNothing({ target: credits.userId });

  // Log signup transaction — idempotent via reference_id check
  const referenceId = `signup:${userId}`;
  const existing = await db
    .select({ id: creditTransactions.id })
    .from(creditTransactions)
    .where(eq(creditTransactions.referenceId, referenceId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(creditTransactions).values({
      userId,
      deltaMicro: DEFAULT_BALANCE_MICRO,
      source: CreditSource.SIGNUP,
      referenceId,
    });
  }
}

/**
 * Returns the current balance in micro-credits for a user.
 * Returns 0 if no credit account exists.
 */
export async function getCreditBalanceMicro(userId: string): Promise<number> {
  const rows = await db
    .select({ balanceMicro: credits.balanceMicro })
    .from(credits)
    .where(eq(credits.userId, userId));

  if (rows.length === 0) {
    return 0;
  }

  return rows[0].balanceMicro ?? 0;
}

/**
 * Applies a credit delta (positive or negative) to a user's balance.
 * Uses GREATEST(0, balance + delta) to prevent negative balances.
 * Also logs the transaction.
 *
 * @returns The new balance after applying the delta.
 */
export async function applyCreditDelta(
  userId: string,
  delta: number,
  source: CreditSource,
  referenceId: string,
  metadata?: Record<string, unknown>,
): Promise<number> {
  // Update balance with floor at 0
  const result = await db
    .update(credits)
    .set({
      balanceMicro: sql`GREATEST(0, ${credits.balanceMicro} + ${delta})`,
    })
    .where(eq(credits.userId, userId))
    .returning({ balanceMicro: credits.balanceMicro });

  const newBalance = result[0]?.balanceMicro ?? 0;

  // Log the transaction
  await db.insert(creditTransactions).values({
    userId,
    deltaMicro: delta,
    source,
    referenceId,
    metadata: metadata ?? null,
  });

  return newBalance;
}
