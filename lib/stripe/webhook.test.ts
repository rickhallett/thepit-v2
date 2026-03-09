/**
 * webhook.test.ts — Unit tests for Stripe webhook handlers.
 *
 * Mocks database and applyCreditDelta to test handler logic in isolation.
 * Tests all 6 event types + idempotency + unknown events.
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// Mock db module
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve()),
    })),
  },
}));

// Mock applyCreditDelta
vi.mock("@/lib/credits/balance", () => ({
  applyCreditDelta: vi.fn(() => Promise.resolve(0)),
}));

// Mock env for resolveTierFromPriceId
vi.mock("@/lib/common/env", () => ({
  getEnv: vi.fn(() => ({
    DATABASE_URL: "postgresql://localhost/test",
    ANTHROPIC_API_KEY: "sk-ant-test",
    CLERK_SECRET_KEY: "sk_test",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test",
    STRIPE_PASS_PRICE_ID: "price_pass_123",
    STRIPE_LAB_PRICE_ID: "price_lab_456",
  })),
  _resetEnvCache: vi.fn(),
}));

import { db } from "@/db";
import { applyCreditDelta } from "@/lib/credits/balance";
import { handleWebhookEvent } from "./webhook";

// ── Mock helpers ──────────────────────────────────────────

function mockSelectReturning(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  } as unknown as ReturnType<typeof db.select>;
}

function mockUpdateCapturing(captureSet: (arg: unknown) => void) {
  return {
    set: vi.fn().mockImplementation((arg: unknown) => {
      captureSet(arg);
      return {
        where: vi.fn().mockResolvedValue(undefined),
      };
    }),
  } as unknown as ReturnType<typeof db.update>;
}

function mockUpdateSimple() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  } as unknown as ReturnType<typeof db.update>;
}

// ── Test fixtures ─────────────────────────────────────────

function makeCheckoutSession(
  overrides: Partial<Stripe.Checkout.Session> = {},
): Stripe.Checkout.Session {
  return {
    id: "cs_test_123",
    object: "checkout.session",
    metadata: {
      userId: "user_test_123",
      creditsMicro: "50000",
    },
    ...overrides,
  } as Stripe.Checkout.Session;
}

function makeSubscription(
  overrides: Partial<Stripe.Subscription> & {
    priceId?: string;
    customerId?: string;
  } = {},
): Stripe.Subscription {
  const {
    priceId = "price_pass_123",
    customerId = "cus_test_123",
    ...rest
  } = overrides;
  return {
    id: "sub_test_123",
    object: "subscription",
    customer: customerId,
    status: "active",
    metadata: {
      userId: "user_test_123",
    },
    items: {
      object: "list",
      data: [
        {
          id: "si_test",
          object: "subscription_item",
          price: {
            id: priceId,
            object: "price",
          } as Stripe.Price,
        } as Stripe.SubscriptionItem,
      ],
    } as Stripe.ApiList<Stripe.SubscriptionItem>,
    ...rest,
  } as Stripe.Subscription;
}

function makeInvoice(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return {
    id: "in_test_123",
    object: "invoice",
    customer: "cus_test_123",
    billing_reason: "subscription_cycle",
    lines: {
      object: "list",
      data: [
        {
          id: "il_test",
          object: "line_item",
          pricing: {
            price_details: {
              price: { id: "price_pass_123" },
            },
          },
        },
      ],
    },
    ...overrides,
  } as Stripe.Invoice;
}

function makeEvent(type: string, dataObject: unknown): Stripe.Event {
  return {
    id: `evt_test_${Date.now()}`,
    object: "event",
    type,
    data: {
      object: dataObject,
    },
  } as Stripe.Event;
}

// ── Tests ─────────────────────────────────────────────────

describe("handleWebhookEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: no existing reference_id (not idempotent blocked)
    vi.mocked(db.select).mockReturnValue(mockSelectReturning([]));

    // Default: update returns successfully
    vi.mocked(db.update).mockReturnValue(mockUpdateSimple());
  });

  describe("checkout.session.completed", () => {
    it("applies credits with correct reference_id", async () => {
      const session = makeCheckoutSession();
      const event = makeEvent("checkout.session.completed", session);

      await handleWebhookEvent(event);

      expect(applyCreditDelta).toHaveBeenCalledWith(
        "user_test_123",
        50000,
        "purchase",
        "purchase:cs_test_123",
      );
    });

    it("ignores session without userId metadata", async () => {
      const session = makeCheckoutSession({ metadata: {} });
      const event = makeEvent("checkout.session.completed", session);

      await handleWebhookEvent(event);

      expect(applyCreditDelta).not.toHaveBeenCalled();
    });

    it("ignores session without creditsMicro metadata", async () => {
      const session = makeCheckoutSession({
        metadata: { userId: "user_123" },
      });
      const event = makeEvent("checkout.session.completed", session);

      await handleWebhookEvent(event);

      expect(applyCreditDelta).not.toHaveBeenCalled();
    });

    it("is idempotent — skips if reference_id exists", async () => {
      // Simulate existing transaction
      vi.mocked(db.select).mockReturnValue(mockSelectReturning([{ id: 1 }]));

      const session = makeCheckoutSession();
      const event = makeEvent("checkout.session.completed", session);

      await handleWebhookEvent(event);

      expect(applyCreditDelta).not.toHaveBeenCalled();
    });
  });

  describe("customer.subscription.created", () => {
    it("updates tier and applies subscription grant", async () => {
      const subscription = makeSubscription();
      const event = makeEvent("customer.subscription.created", subscription);

      await handleWebhookEvent(event);

      // Check tier update
      expect(db.update).toHaveBeenCalled();

      // Check grant applied (pass tier = 30000 micro)
      expect(applyCreditDelta).toHaveBeenCalledWith(
        "user_test_123",
        30000,
        "subscription_grant",
        "sub_grant:sub_test_123",
      );
    });

    it("applies lab tier grant (60000 micro)", async () => {
      const subscription = makeSubscription({ priceId: "price_lab_456" });
      const event = makeEvent("customer.subscription.created", subscription);

      await handleWebhookEvent(event);

      expect(applyCreditDelta).toHaveBeenCalledWith(
        "user_test_123",
        60000,
        "subscription_grant",
        "sub_grant:sub_test_123",
      );
    });

    it("ignores subscription without userId metadata", async () => {
      const subscription = makeSubscription();
      subscription.metadata = {};
      const event = makeEvent("customer.subscription.created", subscription);

      await handleWebhookEvent(event);

      expect(db.update).not.toHaveBeenCalled();
      expect(applyCreditDelta).not.toHaveBeenCalled();
    });
  });

  describe("customer.subscription.updated", () => {
    it("applies incremental grant on upgrade from free to pass", async () => {
      // Call sequence: 1) user tier query, 2) hasProcessedReference (idempotency)
      vi.mocked(db.select)
        .mockReturnValueOnce(
          mockSelectReturning([{ subscriptionTier: "free" }]),
        )
        .mockReturnValueOnce(mockSelectReturning([]));

      const subscription = makeSubscription({ priceId: "price_pass_123" });
      const event = makeEvent("customer.subscription.updated", subscription);

      await handleWebhookEvent(event);

      // Pass grant (30000) - free grant (0) = 30000
      expect(applyCreditDelta).toHaveBeenCalledWith(
        "user_test_123",
        30000,
        "subscription_grant",
        "upgrade_grant:sub_test_123:pass",
      );
    });

    it("applies incremental grant on upgrade from pass to lab", async () => {
      // Call sequence: 1) user tier query, 2) hasProcessedReference (idempotency)
      vi.mocked(db.select)
        .mockReturnValueOnce(
          mockSelectReturning([{ subscriptionTier: "pass" }]),
        )
        .mockReturnValueOnce(mockSelectReturning([]));

      const subscription = makeSubscription({ priceId: "price_lab_456" });
      const event = makeEvent("customer.subscription.updated", subscription);

      await handleWebhookEvent(event);

      // Lab grant (60000) - pass grant (30000) = 30000
      expect(applyCreditDelta).toHaveBeenCalledWith(
        "user_test_123",
        30000,
        "subscription_grant",
        "upgrade_grant:sub_test_123:lab",
      );
    });

    it("does not apply grant on downgrade", async () => {
      // Mock current tier as lab
      vi.mocked(db.select).mockReturnValue(
        mockSelectReturning([{ subscriptionTier: "lab" }]),
      );

      const subscription = makeSubscription({ priceId: "price_pass_123" });
      const event = makeEvent("customer.subscription.updated", subscription);

      await handleWebhookEvent(event);

      // Pass grant (30000) - lab grant (60000) = -30000 (negative, no grant)
      expect(applyCreditDelta).not.toHaveBeenCalled();
    });

    it("ignores subscription without userId metadata", async () => {
      const subscription = makeSubscription();
      subscription.metadata = {};
      const event = makeEvent("customer.subscription.updated", subscription);

      await handleWebhookEvent(event);

      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe("customer.subscription.deleted", () => {
    it("sets tier to free and status to canceled", async () => {
      const subscription = makeSubscription();
      const event = makeEvent("customer.subscription.deleted", subscription);

      let capturedSetArg: unknown;
      vi.mocked(db.update).mockReturnValue(
        mockUpdateCapturing((arg) => {
          capturedSetArg = arg;
        }),
      );

      await handleWebhookEvent(event);

      expect(capturedSetArg).toEqual({
        subscriptionTier: "free",
        subscriptionStatus: "canceled",
        subscriptionId: null,
      });
    });

    it("does not clawback credits", async () => {
      const subscription = makeSubscription();
      const event = makeEvent("customer.subscription.deleted", subscription);

      await handleWebhookEvent(event);

      // No credit delta should be applied
      expect(applyCreditDelta).not.toHaveBeenCalled();
    });

    it("ignores subscription without userId metadata", async () => {
      const subscription = makeSubscription();
      subscription.metadata = {};
      const event = makeEvent("customer.subscription.deleted", subscription);

      await handleWebhookEvent(event);

      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe("invoice.payment_failed", () => {
    it("downgrades tier to free with past_due status", async () => {
      const invoice = makeInvoice();
      const event = makeEvent("invoice.payment_failed", invoice);

      let capturedSetArg: unknown;
      vi.mocked(db.update).mockReturnValue(
        mockUpdateCapturing((arg) => {
          capturedSetArg = arg;
        }),
      );

      await handleWebhookEvent(event);

      expect(capturedSetArg).toEqual({
        subscriptionTier: "free",
        subscriptionStatus: "past_due",
      });
    });

    it("ignores invoice without customer", async () => {
      const invoice = makeInvoice({ customer: null });
      const event = makeEvent("invoice.payment_failed", invoice);

      await handleWebhookEvent(event);

      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe("invoice.payment_succeeded", () => {
    it("skips first invoice (billing_reason = subscription_create)", async () => {
      const invoice = makeInvoice({ billing_reason: "subscription_create" });
      const event = makeEvent("invoice.payment_succeeded", invoice);

      await handleWebhookEvent(event);

      // Should not apply any credit or update
      expect(applyCreditDelta).not.toHaveBeenCalled();
    });

    it("applies monthly grant for renewal invoice", async () => {
      // Call sequence: 1) find user by stripe_customer_id, 2) hasProcessedReference
      vi.mocked(db.select)
        .mockReturnValueOnce(
          mockSelectReturning([
            { id: "user_test_123", subscriptionTier: "pass" },
          ]),
        )
        .mockReturnValueOnce(mockSelectReturning([]));

      const invoice = makeInvoice({ billing_reason: "subscription_cycle" });
      const event = makeEvent("invoice.payment_succeeded", invoice);

      await handleWebhookEvent(event);

      // Pass monthly grant = 30000
      expect(applyCreditDelta).toHaveBeenCalledWith(
        "user_test_123",
        30000,
        "monthly_grant",
        "monthly:in_test_123",
      );
    });

    it("restores subscription status to active", async () => {
      // Call sequence: 1) find user, 2) hasProcessedReference
      vi.mocked(db.select)
        .mockReturnValueOnce(
          mockSelectReturning([
            { id: "user_test_123", subscriptionTier: "pass" },
          ]),
        )
        .mockReturnValueOnce(mockSelectReturning([]));

      let capturedSetArg: unknown;
      vi.mocked(db.update).mockReturnValue(
        mockUpdateCapturing((arg) => {
          capturedSetArg = arg;
        }),
      );

      const invoice = makeInvoice();
      const event = makeEvent("invoice.payment_succeeded", invoice);

      await handleWebhookEvent(event);

      // DC4: handlePaymentSucceeded now restores BOTH tier (from invoice price)
      // and status. This handles payment recovery after payment_failed downgrade.
      expect(capturedSetArg).toEqual({
        subscriptionTier: "pass",
        subscriptionStatus: "active",
      });
    });

    it("ignores invoice without customer", async () => {
      const invoice = makeInvoice({ customer: null });
      const event = makeEvent("invoice.payment_succeeded", invoice);

      await handleWebhookEvent(event);

      expect(applyCreditDelta).not.toHaveBeenCalled();
    });

    it("ignores if user not found", async () => {
      // Mock not finding user
      vi.mocked(db.select).mockReturnValue(mockSelectReturning([]));

      const invoice = makeInvoice();
      const event = makeEvent("invoice.payment_succeeded", invoice);

      await handleWebhookEvent(event);

      expect(applyCreditDelta).not.toHaveBeenCalled();
    });
  });

  describe("idempotency", () => {
    it("same checkout.session.completed event twice → second is no-op", async () => {
      const session = makeCheckoutSession();
      const event = makeEvent("checkout.session.completed", session);

      // First call: no existing reference
      vi.mocked(db.select).mockReturnValueOnce(mockSelectReturning([]));

      await handleWebhookEvent(event);
      expect(applyCreditDelta).toHaveBeenCalledTimes(1);

      // Second call: reference exists
      vi.mocked(db.select).mockReturnValue(mockSelectReturning([{ id: 1 }]));

      await handleWebhookEvent(event);
      // Still only 1 call total
      expect(applyCreditDelta).toHaveBeenCalledTimes(1);
    });
  });

  describe("unknown events", () => {
    it("does not throw for unknown event type", async () => {
      const event = makeEvent("some.unknown.event", { foo: "bar" });

      await expect(handleWebhookEvent(event)).resolves.toBeUndefined();
    });

    it("does not call any handlers for unknown event", async () => {
      const event = makeEvent("customer.created", { id: "cus_123" });

      await handleWebhookEvent(event);

      expect(db.update).not.toHaveBeenCalled();
      expect(applyCreditDelta).not.toHaveBeenCalled();
    });
  });
});
