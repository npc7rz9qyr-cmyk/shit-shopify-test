import { AccountType, Prisma } from "@prisma/client";
import prisma from "../db.server";

const DEFAULT_ACCOUNTS = [
  { code: "1100", name: "Bank", type: AccountType.ASSET, systemKey: "BANK" },
  {
    code: "1300",
    name: "Shopify tussenrekening",
    type: AccountType.ASSET,
    systemKey: "SHOPIFY_CLEARING",
  },
  {
    code: "1520",
    name: "Af te dragen btw",
    type: AccountType.LIABILITY,
    systemKey: "VAT_PAYABLE",
  },
  {
    code: "1530",
    name: "Te vorderen btw",
    type: AccountType.ASSET,
    systemKey: "VAT_RECEIVABLE",
  },
  {
    code: "4500",
    name: "Algemene bedrijfskosten",
    type: AccountType.EXPENSE,
    systemKey: "GENERAL_EXPENSE",
  },
  {
    code: "4700",
    name: "Betaalproviderkosten",
    type: AccountType.EXPENSE,
    systemKey: "PAYMENT_FEES",
  },
  {
    code: "7000",
    name: "Inkoopwaarde omzet",
    type: AccountType.EXPENSE,
    systemKey: "COGS",
  },
  {
    code: "8000",
    name: "Webshopomzet",
    type: AccountType.REVENUE,
    systemKey: "SALES",
  },
  {
    code: "8010",
    name: "Verzendopbrengsten",
    type: AccountType.REVENUE,
    systemKey: "SHIPPING_REVENUE",
  },
  {
    code: "8090",
    name: "Kortingen",
    type: AccountType.REVENUE,
    systemKey: "DISCOUNTS",
  },
] as const;

export async function ensureDefaultChart(shopId: string) {
  await prisma.$transaction(
    DEFAULT_ACCOUNTS.map((account) =>
      prisma.ledgerAccount.upsert({
        where: {
          shopId_systemKey: {
            shopId,
            systemKey: account.systemKey,
          },
        },
        update: {
          code: account.code,
          name: account.name,
          type: account.type,
        },
        create: {
          shopId,
          ...account,
        },
      }),
    ),
  );

  const taxCodes = [
    { code: "NL21", name: "Nederland 21%", rate: 21, reportingBox: "1a" },
    { code: "NL9", name: "Nederland 9%", rate: 9, reportingBox: "1b" },
    { code: "NL0", name: "Nederland 0%", rate: 0, reportingBox: "1e" },
  ];

  await prisma.$transaction(
    taxCodes.map((taxCode) =>
      prisma.taxCode.upsert({
        where: { shopId_code: { shopId, code: taxCode.code } },
        update: taxCode,
        create: { shopId, ...taxCode },
      }),
    ),
  );
}

export async function getSystemAccounts(
  shopId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const accounts = await client.ledgerAccount.findMany({ where: { shopId } });
  return new Map(accounts.map((account) => [account.systemKey, account]));
}
