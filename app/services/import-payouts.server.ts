import { JournalStatus, Prisma } from "@prisma/client";
import prisma from "../db.server";
import { getSystemAccounts } from "./chart.server";
import { stableHash } from "./hash.server";
import { moneyToCents } from "./money";
import { buildPayoutJournal } from "./payout-core";

type AdminGraphqlContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type PayoutNode = {
  id: string;
  legacyResourceId: string;
  issuedAt: string;
  status: string;
  transactionType: string;
  net: { amount: string; currencyCode: string };
};

const QUERY = `#graphql
  query AccountingPayouts($first: Int!, $after: String, $query: String) {
    shopifyPaymentsAccount {
      payouts(first: $first, after: $after, query: $query, sortKey: ISSUED_AT) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          legacyResourceId
          issuedAt
          status
          transactionType
          net { amount currencyCode }
        }
      }
    }
  }
`;

export async function importPayouts(
  admin: AdminGraphqlContext,
  shopId: string,
  startDate: Date,
) {
  let after: string | null = null;
  let imported = 0;

  do {
    const response = await admin.graphql(QUERY, {
      variables: {
        first: 50,
        after,
        query: `issued_at:>=${startDate.toISOString().slice(0, 10)}`,
      },
    });
    const body = (await response.json()) as {
      data?: { shopifyPaymentsAccount?: { payouts: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: PayoutNode[] } } | null };
      errors?: Array<{ message: string }>;
    };

    if (body.errors?.length) throw new Error(body.errors.map((item) => item.message).join("; "));
    const connection = body.data?.shopifyPaymentsAccount?.payouts;
    if (!connection) throw new Error("Shopify Payments is niet actief of niet toegankelijk.");

    for (const payout of connection.nodes) {
      await storePayout(shopId, payout);
      imported += 1;
    }

    after = connection.pageInfo.endCursor;
    if (!connection.pageInfo.hasNextPage) break;
  } while (after);

  return { imported };
}

async function storePayout(shopId: string, payout: PayoutNode) {
  const netCents = moneyToCents(payout.net.amount);
  const hash = stableHash(payout);
  const existing = await prisma.payout.findUnique({
    where: { shopId_shopifyPayoutId: { shopId, shopifyPayoutId: payout.id } },
  });
  if (existing?.sourceHash === hash) return existing;

  return prisma.$transaction(async (tx) => {
    let journalEntryId: string | null = null;
    if (payout.status === "PAID") {
      const accounts = await getSystemAccounts(shopId, tx);
      const draft = buildPayoutJournal({
        reference: payout.legacyResourceId,
        netCents,
        feeExpenseCents: 0n,
        clearingCents: netCents,
      });
      const latest = await tx.journalEntry.aggregate({ where: { shopId }, _max: { entryNumber: true } });
      const entry = await tx.journalEntry.create({
        data: {
          shopId,
          entryNumber: (latest._max.entryNumber || 0) + 1,
          date: new Date(payout.issuedAt),
          description: `Shopify-uitbetaling ${payout.legacyResourceId}`,
          sourceType: "SHOPIFY_PAYOUT",
          sourceId: payout.id,
          sourceHash: hash,
          status: JournalStatus.POSTED,
          postedAt: new Date(),
          warning: "Transactiekosten worden in deze MVP nog niet per balance transaction uitgesplitst.",
          lines: {
            create: draft.lines.map((line) => {
              const account = accounts.get(line.systemKey);
              if (!account) throw new Error(`Grootboekrekening ontbreekt: ${line.systemKey}`);
              return { accountId: account.id, debitCents: line.debitCents, creditCents: line.creditCents, memo: line.memo };
            }),
          },
        },
      });
      journalEntryId = entry.id;
    }

    const data = {
      legacyResourceId: payout.legacyResourceId,
      issuedAt: new Date(payout.issuedAt),
      status: payout.status,
      transactionType: payout.transactionType,
      currency: payout.net.currencyCode,
      netCents,
      feeCents: 0n,
      clearingCents: netCents,
      transactionAmountCents: netCents,
      sourceHash: hash,
      sourceJson: payout as Prisma.InputJsonValue,
      journalEntryId,
    };

    return tx.payout.upsert({
      where: { shopId_shopifyPayoutId: { shopId, shopifyPayoutId: payout.id } },
      update: data,
      create: { shopId, shopifyPayoutId: payout.id, ...data },
    });
  });
}
