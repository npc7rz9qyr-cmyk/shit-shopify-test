import type { NormalizedOrder } from "./order-normalizer.server";

export type DraftJournalLine = { systemKey: string; debitCents: bigint; creditCents: bigint; memo: string };
export type DraftJournal = { description: string; date: Date; lines: DraftJournalLine[]; warning?: string };
const positive = (value: bigint) => value > 0n ? value : 0n;

export function buildOrderJournal(order: NormalizedOrder): DraftJournal {
  const netGross = positive(order.grossCents);
  const netTax = positive(order.taxCents > netGross ? netGross : order.taxCents);
  const netRevenue = positive(netGross - netTax);
  const shippingExTax = order.taxesIncluded && netGross > 0n ? (order.shippingCents * netRevenue) / netGross : order.shippingCents;
  const shippingRevenue = positive(shippingExTax > netRevenue ? netRevenue : shippingExTax);
  const productRevenue = positive(netRevenue - shippingRevenue);
  const lines: DraftJournalLine[] = [];
  if (netGross > 0n) lines.push({ systemKey: "SHOPIFY_CLEARING", debitCents: netGross, creditCents: 0n, memo: `Te ontvangen voor ${order.orderNumber}` });
  if (productRevenue > 0n) lines.push({ systemKey: "SALES", debitCents: 0n, creditCents: productRevenue, memo: `Productomzet ${order.orderNumber}` });
  if (shippingRevenue > 0n) lines.push({ systemKey: "SHIPPING_REVENUE", debitCents: 0n, creditCents: shippingRevenue, memo: `Verzendopbrengst ${order.orderNumber}` });
  if (netTax > 0n) lines.push({ systemKey: "VAT_PAYABLE", debitCents: 0n, creditCents: netTax, memo: `Btw ${order.orderNumber}` });
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
  return { description: `Shopify-order ${order.orderNumber}`, date: order.processedAt, lines, warning: order.taxesIncluded && order.shippingCents > 0n && netTax > 0n ? "Het btw-aandeel in de verzendopbrengst is proportioneel verdeeld; controleer bij gemengde btw-tarieven." : undefined };
}

export function assertBalanced(lines: DraftJournalLine[]) {
  const debit = lines.reduce((sum, line) => sum + line.debitCents, 0n);
  const credit = lines.reduce((sum, line) => sum + line.creditCents, 0n);
  if (debit !== credit) throw new Error(`Journaalpost niet in balans: debet=${debit}, credit=${credit}`);
}
