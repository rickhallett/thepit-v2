// POST /api/reactions — toggle heart/fire reaction on a bout turn.
// Auth optional: anonymous uses IP-based fingerprint.
// Rate limit: 30/min per IP.

import { NextRequest } from "next/server";
import {
  errorResponse,
  parseValidBody,
  rateLimitResponse,
  API_ERRORS,
} from "@/lib/common/api-utils";
import { createRateLimiter } from "@/lib/common/rate-limit";
import { getAuthUserId } from "@/lib/auth/middleware";
import {
  ReactionRequestSchema,
  toggleReaction,
  computeFingerprint,
} from "@/lib/engagement/reactions";

// 30 requests per minute per IP
const rateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 30 });

function getClientIp(req: NextRequest): string {
  // Prefer x-forwarded-for (first IP in chain), fall back to x-real-ip
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;
  // Fallback for local dev
  return "127.0.0.1";
}

export async function POST(req: NextRequest) {
  // 1. Parse and validate body
  const parsed = await parseValidBody(req, ReactionRequestSchema);
  if (!parsed.success) {
    return parsed.response;
  }
  const { boutId, turnIndex, reactionType } = parsed.data;

  // 2. Get userId (optional)
  const userId = await getAuthUserId();

  // 3. Get IP and compute fingerprint
  const ip = getClientIp(req);
  const clientFingerprint = computeFingerprint(userId, ip);

  // 4. Rate limit check
  const limit = rateLimiter.check(ip);
  if (!limit.ok) {
    return rateLimitResponse(limit);
  }

  // 5. Toggle reaction
  try {
    const result = await toggleReaction({
      boutId,
      turnIndex,
      reactionType,
      userId,
      clientFingerprint,
    });

    return Response.json({
      ok: true,
      action: result.action,
      counts: result.counts,
    });
  } catch (err) {
    console.error("Reaction toggle failed:", err);
    return errorResponse(500, API_ERRORS.INTERNAL, "Failed to toggle reaction");
  }
}
