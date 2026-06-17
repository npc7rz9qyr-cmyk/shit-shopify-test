import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { AccountType } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";
import { formatEuros } from "../services/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const accounts = await prisma.ledgerAccount.findMany({ where: { shopId: shop.id }, orderBy: { code: "asc" }, include: { lines: { where: { entry: { status: { in: ["POSTED", "REVERSED"] } } } } } });
  const rows = accounts.map((account) => {
    const debit = account.lines.reduce((sum, line) => sum + line.debitCents, 0n);
    const credit = account.lines.reduce((sum, line) => sum + line.creditCents, 0n);
    const balance = account.type === AccountType.ASSET || account.type === AccountType.EXPENSE ? debit - credit : credit - debit;
    return { id: account.id, code: account.code, name: account.name, type: account.type, debit: debit.toString(), credit: credit.toString(), balance: balance.toString() };
  });
  const profit = rows.filter((row) => row.type === "REVENUE" || row.type === "EXPENSE").reduce((sum, row) => sum + (row.type === "REVENUE" ? BigInt(row.balance) : -BigInt(row.balance)), 0n);
  const totalDebit = rows.reduce((sum, row) => sum + BigInt(row.debit), 0n);
  const totalCredit = rows.reduce((sum, row) => sum + BigInt(row.credit), 0n);
  return { rows, profit: profit.toString(), totalDebit: totalDebit.toString(), totalCredit: totalCredit.toString(), balanced: totalDebit === totalCredit };
};

export default function ReportsPage() {
  const data = useLoaderData<typeof loader>();
  return <s-page heading="Rapportages"><s-button slot="primary-action" href="/app/export">CSV exporteren</s-button><s-section heading="Controle"><s-banner tone={data.balanced ? "success" : "critical"}>Proefbalans {data.balanced ? "is in evenwicht" : "is niet in evenwicht"}. Debet {formatEuros(BigInt(data.totalDebit))}, credit {formatEuros(BigInt(data.totalCredit))}.</s-banner></s-section><s-section heading="Resultaat"><s-heading>{formatEuros(BigInt(data.profit))}</s-heading><s-paragraph>Voorlopige winst op basis van geboekte omzet en kosten.</s-paragraph></s-section><s-section heading="Proef- en saldibalans"><s-table><s-table-header-row><s-table-header>Code</s-table-header><s-table-header>Rekening</s-table-header><s-table-header>Debet</s-table-header><s-table-header>Credit</s-table-header><s-table-header>Saldo</s-table-header></s-table-header-row><s-table-body>{data.rows.map((row) => <s-table-row key={row.id}><s-table-cell>{row.code}</s-table-cell><s-table-cell>{row.name}</s-table-cell><s-table-cell>{formatEuros(BigInt(row.debit))}</s-table-cell><s-table-cell>{formatEuros(BigInt(row.credit))}</s-table-cell><s-table-cell>{formatEuros(BigInt(row.balance))}</s-table-cell></s-table-row>)}</s-table-body></s-table></s-section></s-page>;
}
