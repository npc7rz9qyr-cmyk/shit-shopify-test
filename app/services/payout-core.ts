export type PayoutDraftLine = {
  systemKey: "BANK" | "PAYMENT_FEES" | "SHOPIFY_CLEARING";
  debitCents: bigint;
  creditCents: bigint;
  memo: string;
};

export type PayoutDraft = {
  lines: PayoutDraftLine[];
};

function signedLine(
  systemKey: PayoutDraftLine["systemKey"],
  value: bigint,
  positiveSide: "DEBIT" | "CREDIT",
  memo: string,
): PayoutDraftLine | null {
  if (value === 0n) return null;

  const positive = value > 0n;
  const amount = positive ? value : -value;
  const debit =
    (positive && positiveSide === "DEBIT") ||
    (!positive && positiveSide === "CREDIT");

  return {
    systemKey,
    debitCents: debit ? amount : 0n,
    creditCents: debit ? 0n : amount,
    memo,
  };
}

/**
 * Shopify Payments relationship:
 *   netto payout + kostenlast = bruto mutatie op de Shopify-tussenrekening.
 *
 * feeExpenseCents is positive for a cost and negative for a fee rebate.
 * clearingCents is positive when Shopify clears receivables and negative when
 * money moves back towards Shopify (for example a negative payout).
 */
export function buildPayoutJournal(input: {
  reference: string;
  netCents: bigint;
  feeExpenseCents: bigint;
  clearingCents: bigint;
}): PayoutDraft {
  const { reference, netCents, feeExpenseCents, clearingCents } = input;
  const lines = [
    signedLine(
      "BANK",
      netCents,
      "DEBIT",
      `Netto Shopify-uitbetaling ${reference}`,
    ),
    signedLine(
      "PAYMENT_FEES",
      feeExpenseCents,
      "DEBIT",
      `Shopify Payments-kosten ${reference}`,
    ),
    signedLine(
      "SHOPIFY_CLEARING",
      clearingCents,
      "CREDIT",
      `Aflettering Shopify-tussenrekening ${reference}`,
    ),
  ].filter((line): line is PayoutDraftLine => line !== null);

  assertPayoutBalanced(lines);
  return { lines };
}

export function assertPayoutBalanced(lines: PayoutDraftLine[]) {
  const debit = lines.reduce((sum, line) => sum + line.debitCents, 0n);
  const credit = lines.reduce((sum, line) => sum + line.creditCents, 0n);
  if (debit !== credit) {
    throw new Error(
      `Payoutboeking niet in balans: debet=${debit}, credit=${credit}`,
    );
  }
}
