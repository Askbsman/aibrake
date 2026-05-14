import type {
  PaidResource,
  PaymentGuard,
  PaymentResult,
} from "./payment-guard.js";

// Placeholder for the future x402 payment integration. The stub deliberately
// throws so any wiring of it without an explicit feature flag fails loudly in
// CI rather than silently passing requests through.
export class X402PaymentGuardStub implements PaymentGuard {
  async requirePayment(_resource: PaidResource, _req: unknown): Promise<PaymentResult> {
    throw new Error("x402 payment guard is not implemented in Stage 0.1 (stub).");
  }
}
