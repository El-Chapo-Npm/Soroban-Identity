import { describe, it, expect, beforeEach } from "vitest";
import { SAMPLE_LISTINGS, filterListings, cartTotal, checkout, requestRefund, setPaymentGateway, setNotificationService } from "./marketplaceService";

describe("marketplace service", () => {
  beforeEach(() => {
    localStorage.clear();
    setPaymentGateway({
      createPaymentIntent: async () => ({ id: "pi_1", clientSecret: "s" }),
      confirmPayment: async () => ({ status: "succeeded" }),
      refund: async () => ({ status: "pending" }),
    });
    setNotificationService({ sendPurchaseConfirmation: async () => undefined });
  });

  it("filters by query, category and rating", () => {
    expect(filterListings(SAMPLE_LISTINGS, { query: "kyc" })).toHaveLength(1);
    expect(filterListings(SAMPLE_LISTINGS, { category: "service" })).toHaveLength(1);
    expect(filterListings(SAMPLE_LISTINGS, { minRating: 4.8 })).toHaveLength(1);
  });

  it("checks out, records history and requests a refund", async () => {
    const items = [{ listing: SAMPLE_LISTINGS[0], quantity: 2 }];
    expect(cartTotal(items)).toBe(98);
    const p = await checkout(items, "a@b.c");
    expect(p.status).toBe("completed");
    const r = await requestRefund(p.id, "not needed");
    expect(r.status).toBe("refund_requested");
  });
});
