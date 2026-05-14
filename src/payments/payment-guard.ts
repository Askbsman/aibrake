// Payment abstraction. Spending Guard is x402-ready, not x402-only.
// In v0.1 routes do NOT gate on payment by default
// (SPENDING_GUARD_REQUIRE_PAYMENT=false). The abstraction exists so adding
// x402 later does not require API surface changes.

export interface PaidResource {
  endpoint: string;        // e.g. "/v1/check"
  priceUsd: number;
  description?: string;
}

export interface PaymentResult {
  ok: boolean;
  receipt?: string;
  error?: { code: string; message: string };
}

export interface PaymentGuard {
  requirePayment(resource: PaidResource, req: unknown): Promise<PaymentResult>;
}
