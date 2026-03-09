/**
 * lib/sharing/short-links.ts — Short link creation and resolution.
 *
 * Short links use nanoid(8) slugs for memorable, shareable URLs.
 * One short link per bout (unique constraint on bout_id).
 * createShortLink is idempotent — returns existing slug if already created.
 */

import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/db";
import { shortLinks } from "@/db/schema";
import { eq } from "drizzle-orm";

export const ShortLinkRequestSchema = z.object({
  boutId: z.string().min(1),
});

/**
 * Creates a short link for a bout, or returns the existing one.
 * Idempotent: same boutId always returns same slug.
 */
export async function createShortLink(boutId: string): Promise<string> {
  // 1. Check if short link already exists for this boutId
  const existing = await db
    .select({ slug: shortLinks.slug })
    .from(shortLinks)
    .where(eq(shortLinks.boutId, boutId))
    .limit(1);

  if (existing.length > 0 && existing[0].slug) {
    return existing[0].slug;
  }

  // 2. Generate slug: nanoid(8)
  const slug = nanoid(8);

  // 3. INSERT with ON CONFLICT DO NOTHING for race condition safety
  await db
    .insert(shortLinks)
    .values({ boutId, slug })
    .onConflictDoNothing({ target: shortLinks.boutId });

  // 4. If INSERT was a no-op (race condition), SELECT again and return
  const [result] = await db
    .select({ slug: shortLinks.slug })
    .from(shortLinks)
    .where(eq(shortLinks.boutId, boutId))
    .limit(1);

  return result.slug!;
}

/**
 * Resolves a short link slug to a bout ID.
 * Returns null if slug doesn't exist.
 */
export async function resolveShortLink(slug: string): Promise<string | null> {
  const [result] = await db
    .select({ boutId: shortLinks.boutId })
    .from(shortLinks)
    .where(eq(shortLinks.slug, slug))
    .limit(1);

  return result?.boutId ?? null;
}
