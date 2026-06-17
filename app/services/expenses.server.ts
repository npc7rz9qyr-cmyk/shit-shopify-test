import { JournalStatus, Prisma } from "@prisma/client";
import prisma from "../db.server";
import { getSystemAccounts } from "./chart.server";

export type ExpenseInput = {
  date: Date;
  supplier: string;
  description: string;
  invoiceNumber?: string;
  netCents: bigint;
  vatCents: bigint;
  totalCents: bigint;
};

export async function postExpense(shopId: string, input: ExpenseInput) {
  if (!input.supplier.trim()) throw new Error("Leverancier is verplicht");
  if (!input.description.trim()) throw new Error("Omschrijving is verplicht");
  if (input.netCents < 0n || input.vatCents < 0n || input.totalCents <= 0n) throw new Error("Bedragen moeten positief zijn");
  if (input.netCents + input.vatCents !== input.totalCents) throw new Error("Totaal moet gelijk zijn aan exclusief bedrag plus btw");

  return prisma.$transaction(async (tx) => {
    const accounts = await getSystemAccounts(shopId, tx);
    const expenseAccount = accounts.get("GENERAL_EXPENSE");
    const vatAccount = accounts.get("VAT_RECEIVABLE");
    const bankAccount = accounts.get("BANK");
    if (!expenseAccount || !vatAccount || !bankAccount) throw new Error("Benodigde kostenrekeningen ontbreken");

    const entryNumber = await nextEntryNumber(tx, shopId);
    const entry = await tx.journalEntry.create({
      data: {
        shopId,
        entryNumber,
        date: input.date,
        description: `${input.supplier}: ${input.description}`,
        sourceType: "MANUAL_EXPENSE",
        sourceId: input.invoiceNumber || `expense-${Date.now()}`,
        sourceHash: `manual:${Date.now()}:${input.totalCents}`,
        status: JournalStatus.POSTED,
        postedAt: new Date(),
        lines: {
          create: [
            { accountId: expenseAccount.id, debitCents: input.netCents, creditCents: 0n, memo: input.description },
            ...(input.vatCents > 0n ? [{ accountId: vatAccount.id, debitCents: input.vatCents, creditCents: 0n, memo: `Voorbelasting ${input.description}` }] : []),
            { accountId: bankAccount.id, debitCents: 0n, creditCents: input.totalCents, memo: `Betaling ${input.supplier}` },
          ],
        },
      },
    });

    return tx.expense.create({
      data: {
        shopId,
        date: input.date,
        supplier: input.supplier.trim(),
        description: input.description.trim(),
        invoiceNumber: input.invoiceNumber?.trim() || null,
        netCents: input.netCents,
        vatCents: input.vatCents,
        totalCents: input.totalCents,
        journalEntryId: entry.id,
      },
    });
  });
}

async function nextEntryNumber(tx: Prisma.TransactionClient, shopId: string): Promise<number> {
  const latest = await tx.journalEntry.aggregate({ where: { shopId }, _max: { entryNumber: true } });
  return (latest._max.entryNumber || 0) + 1;
}
