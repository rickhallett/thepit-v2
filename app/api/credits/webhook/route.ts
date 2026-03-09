/**
 * Stripe webhook endpoint — verifies signature and dispatches to handlers.
 *
 * Route: POST /api/credits/webhook
 * Auth: Stripe signature verification (not Clerk)
 */

import Stripe from "stripe";
import { handleWebhookEvent } from "@/lib/stripe/webhook";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
});

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return new Response("Missing signature", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  await handleWebhookEvent(event);
  return new Response("ok", { status: 200 });
}
