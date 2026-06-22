import type { NormalizedOrder } from "./order-normalizer.server";

export type DraftJournalLine = { systemKey: string; debitCents: bigint; creditCents: bigint; memo: string };
export type DraftJournal = { description: string; date: Date; lines: DraftJournalLine[]; warning?: string };
const positive = (value: bigint) => value > 0n ? value : 0n;

export function buildOrderJournal(order: NormalizedOrder): DraftJournal {
  const netGross = positive(order.grossCents);
  const netTax = positive(order.taxCents > netGross ? netGross : order.taxCents);
  const netRevenue = positive(netGross - netTax);
  const lines: DraftJournalLine[] = [];

  if (netGross > 0n) lines.push({ systemKey: "SHOPIFY_CLEARING", debitCents: netGross, creditCents: 0n, memo: `Te ontvangen voor ${order.orderNumber}` });
  if (netRevenue > 0n) lines.push({ systemKey: "SALES", debitCents: 0n, creditCents: netRevenue, memo: `Orderomzet incl. eventuele verzendopbrengst ${order.orderNumber}` });
  if (netTax > 0n) lines.push({ systemKey: "VAT_PAYABLE", debitCents: 0n, creditCents: netTax, memo: `Btw volgens Shopify-order ${order.orderNumber}` });

  const debit = lines.reduce((sum, line) => sum + line.debitCents, 0n);
  const credit = lines.reduce((sum, line) => sum + line.creditCents, 0n);
  if (debit !== credit) {
    const difference = debit - credit;
    if (difference > 0n) {
      const sales = lines.find((line) => line.systemKey === "SALES");
      if (sales) sales.creditCents += difference;
      else lines.push({ systemKey: "SALES", debitCents: 0n, creditCents: difference, memo: `Afronding omzet ${order.orderNumber}` });
    } else if (lines[0]) lines[0].debitCents += -difference;
  }

  return {
    description: `Shopify-order ${order.orderNumber}`,
    date: order.processedAt,
    lines,
    warning: order.shippingCents > 0n ? "Verzendopbrengst zit in de orderomzet. De btw wordt niet opnieuw berekend maar overgenomen uit de Shopify-order." : undefined,
  };
}

export function assertBalanced(lines: DraftJournalLine[]) {
  const debit = lines.reduce((sum, line) => sum + line.debitCents, 0n);
  const credit = lines.reduce((sum, line) => sum + line.creditCents, 0n);
  if (debit !== credit) throw new Error(`Journaalpost niet in balans: debet=${debit}, credit=${credit}`);
}
