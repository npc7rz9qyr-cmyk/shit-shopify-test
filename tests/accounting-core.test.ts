import { describe, expect, it } from "vitest";
import { assertBalanced, buildOrderJournal } from "../app/services/accounting-core";
import type { NormalizedOrder } from "../app/services/order-normalizer.server";
import { buildPayoutJournal } from "../app/services/payout-core";

function order(overrides: Partial<NormalizedOrder> = {}): NormalizedOrder {
  return {
    shopifyOrderId: "gid://shopify/Order/1",
    orderNumber: "#1001",
    processedAt: new Date("2026-06-17T10:00:00Z"),
    currency: "EUR",
    subtotalCents: 10000n,
    taxCents: 2100n,
    shippingCents: 0n,
    discountCents: 0n,
    grossCents: 12100n,
    refundCents: 0n,
    refundTaxCents: 0n,
    taxesIncluded: true,
    source: {},
    ...overrides,
  };
}

describe("boekingsmotor", () => {
  it("maakt een sluitende journaalpost voor 21% btw", () => {
    const journal = buildOrderJournal(order());
    expect(() => assertBalanced(journal.lines)).not.toThrow();
    expect(journal.lines.find((line) => line.systemKey === "VAT_PAYABLE")?.creditCents).toBe(2100n);
  });

  it("gebruikt current totals en trekt een refund niet dubbel af", () => {
    const journal = buildOrderJournal(order({ subtotalCents: 5000n, taxCents: 1050n, grossCents: 6050n, refundCents: 6050n, refundTaxCents: 1050n }));
    expect(() => assertBalanced(journal.lines)).not.toThrow();
    expect(journal.lines.reduce((sum, line) => sum + line.debitCents, 0n)).toBe(6050n);
  });

  it("maakt na een volledige refund een nulpositie", () => {
    const journal = buildOrderJournal(order({ subtotalCents: 0n, taxCents: 0n, grossCents: 0n, refundCents: 12100n, refundTaxCents: 2100n }));
    expect(() => assertBalanced(journal.lines)).not.toThrow();
    expect(journal.lines).toHaveLength(0);
  });
});

describe("payout journal", () => {
  it("boekt een normale uitbetaling en transactiekosten", () => {
    const result = buildPayoutJournal({ reference: "123", netCents: 11750n, feeExpenseCents: 350n, clearingCents: 12100n });
    expect(result.lines.reduce((sum, line) => sum + line.debitCents, 0n)).toBe(12100n);
    expect(result.lines.reduce((sum, line) => sum + line.creditCents, 0n)).toBe(12100n);
  });

  it("boekt een negatieve uitbetaling sluitend", () => {
    const result = buildPayoutJournal({ reference: "124", netCents: -10300n, feeExpenseCents: 300n, clearingCents: -10000n });
    expect(result.lines.reduce((sum, line) => sum + line.debitCents, 0n)).toBe(10300n);
    expect(result.lines.reduce((sum, line) => sum + line.creditCents, 0n)).toBe(10300n);
  });
});
