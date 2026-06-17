import { JournalStatus, OrderSyncStatus, Prisma } from "@prisma/client";
import prisma from "../db.server";
import { stableHash } from "./hash.server";
import { buildOrderJournal, assertBalanced } from "./accounting-core";
import { getSystemAccounts } from "./chart.server";
import type { NormalizedOrder } from "./order-normalizer.server";

function serializeBigints(value: NormalizedOrder) {
  return {
    ...value,
    processedAt: value.processedAt.toISOString(),
    subtotalCents: value.subtotalCents.toString(),
    taxCents: value.taxCents.toString(),
    shippingCents: value.shippingCents.toString(),
    discountCents: value.discountCents.toString(),
    grossCents: value.grossCents.toString(),
    refundCents: value.refundCents.toString(),
    refundTaxCents: value.refundTaxCents.toString(),
    taxesIncluded: value.taxesIncluded,
  };
}

export async function postOrder(shopId: string, normalized: NormalizedOrder) {
  const hash = stableHash(serializeBigints(normalized));
  const current = await prisma.orderSnapshot.findUnique({
    where: { shopId_shopifyOrderId: { shopId, shopifyOrderId: normalized.shopifyOrderId } },
    include: { activeJournalEntry: { include: { lines: true } } },
  });

  if (current?.sourceHash === hash && current.activeJournalEntry) {
    return { status: "unchanged" as const, journalEntry: current.activeJournalEntry };
  }

  const draft = buildOrderJournal(normalized);
  assertBalanced(draft.lines);
  const accounts = await getSystemAccounts(shopId);

  return prisma.$transaction(async (tx) => {
    if (current?.activeJournalEntry) {
      const old = current.activeJournalEntry;
      const reversalNumber = await nextEntryNumber(tx, shopId);
      await tx.journalEntry.create({
        data: {
          shopId,
          entryNumber: reversalNumber,
          date: new Date(),
          description: `Tegenboeking: ${old.description}`,
          sourceType: "ORDER_REVERSAL",
          sourceId: normalized.shopifyOrderId,
          sourceHash: `${hash}:reversal:${old.id}`,
          status: JournalStatus.POSTED,
          postedAt: new Date(),
          reversalOfId: old.id,
          lines: {
            create: old.lines.map((line) => ({
              accountId: line.accountId,
              debitCents: line.creditCents,
              creditCents: line.debitCents,
              memo: `Tegenboeking ${old.entryNumber}`,
            })),
          },
        },
      });
      await tx.journalEntry.update({
        where: { id: old.id },
        data: { status: JournalStatus.REVERSED, reversedAt: new Date() },
      });
    }

    const entryNumber = await nextEntryNumber(tx, shopId);
    const entry = await tx.journalEntry.create({
      data: {
        shopId,
        entryNumber,
        date: draft.date,
        description: draft.description,
        sourceType: "SHOPIFY_ORDER",
        sourceId: normalized.shopifyOrderId,
        sourceHash: hash,
        status: JournalStatus.POSTED,
        postedAt: new Date(),
        warning: draft.warning,
        lines: {
          create: draft.lines.map((line) => {
            const account = accounts.get(line.systemKey);
            if (!account) throw new Error(`Grootboekrekening ontbreekt: ${line.systemKey}`);
            return {
              accountId: account.id,
              debitCents: line.debitCents,
              creditCents: line.creditCents,
              memo: line.memo,
            };
          }),
        },
      },
      include: { lines: true },
    });

    await tx.orderSnapshot.upsert({
      where: { shopId_shopifyOrderId: { shopId, shopifyOrderId: normalized.shopifyOrderId } },
      update: {
        orderNumber: normalized.orderNumber,
        processedAt: normalized.processedAt,
        currency: normalized.currency,
        subtotalCents: normalized.subtotalCents,
        taxCents: normalized.taxCents,
        shippingCents: normalized.shippingCents,
        discountCents: normalized.discountCents,
        grossCents: normalized.grossCents,
        refundCents: normalized.refundCents,
        refundTaxCents: normalized.refundTaxCents,
        sourceHash: hash,
        sourceJson: normalized.source as Prisma.InputJsonValue,
        syncStatus: OrderSyncStatus.POSTED,
        syncError: null,
        activeJournalEntryId: entry.id,
      },
      create: {
        shopId,
        shopifyOrderId: normalized.shopifyOrderId,
        orderNumber: normalized.orderNumber,
        processedAt: normalized.processedAt,
        currency: normalized.currency,
        subtotalCents: normalized.subtotalCents,
        taxCents: normalized.taxCents,
        shippingCents: normalized.shippingCents,
        discountCents: normalized.discountCents,
        grossCents: normalized.grossCents,
        refundCents: normalized.refundCents,
        refundTaxCents: normalized.refundTaxCents,
        sourceHash: hash,
        sourceJson: normalized.source as Prisma.InputJsonValue,
        syncStatus: OrderSyncStatus.POSTED,
        activeJournalEntryId: entry.id,
      },
    });

    return { status: "posted" as const, journalEntry: entry };
  });
}

async function nextEntryNumber(tx: Prisma.TransactionClient, shopId: string): Promise<number> {
  const latest = await tx.journalEntry.aggregate({ where: { shopId }, _max: { entryNumber: true } });
  return (latest._max.entryNumber || 0) + 1;
}
