import type {
  PaidResource,
  PaymentGuard,
  PaymentResult,
} from "./payment-guard.js";

export class MockPaymentGuard implements PaymentGuard {
  async requirePayment(_resource: PaidResource, _req: unknown): Promise<PaymentResult> {
    return { ok: true, receipt: "mock-receipt" };
  }
}
