// Credit economy types — sources for transactions and transaction structure.

import type { MicroCredits } from "@/lib/common/types";

export const CreditSource = {
  SIGNUP: "signup",
  PURCHASE: "purchase",
  PREAUTH: "preauth",
  SETTLEMENT: "settlement",
  REFUND: "refund",
  SUBSCRIPTION_GRANT: "subscription_grant",
  MONTHLY_GRANT: "monthly_grant",
} as const;
export type CreditSource = (typeof CreditSource)[keyof typeof CreditSource];

export interface CreditTransaction {
  userId: string;
  deltaMicro: number;
  source: CreditSource;
  referenceId: string;
  metadata?: Record<string, unknown>;
}
