import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";
import { formatEuros } from "../services/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const entries = await prisma.journalEntry.findMany({ where: { shopId: shop.id }, orderBy: [{ date: "desc" }, { entryNumber: "desc" }], take: 100, include: { lines: { include: { account: true } } } });
  return { entries: entries.map((entry) => ({ id: entry.id, entryNumber: entry.entryNumber, date: entry.date.toISOString(), description: entry.description, status: entry.status, warning: entry.warning, debitCents: entry.lines.reduce((sum, line) => sum + line.debitCents, 0n).toString(), lines: entry.lines.map((line) => ({ id: line.id, account: `${line.account.code} ${line.account.name}`, debitCents: line.debitCents.toString(), creditCents: line.creditCents.toString(), memo: line.memo })) })) };
};

export default function JournalPage() {
  const { entries } = useLoaderData<typeof loader>();
  return <s-page heading="Journaal">{entries.map((entry) => <s-section key={entry.id} heading={`#${entry.entryNumber} ${entry.description}`}><s-paragraph>{new Date(entry.date).toLocaleDateString("nl-NL")} · {entry.status} · {formatEuros(BigInt(entry.debitCents))}</s-paragraph>{entry.warning ? <s-banner tone="warning">{entry.warning}</s-banner> : null}<s-table><s-table-header-row><s-table-header>Rekening</s-table-header><s-table-header>Omschrijving</s-table-header><s-table-header>Debet</s-table-header><s-table-header>Credit</s-table-header></s-table-header-row><s-table-body>{entry.lines.map((line) => <s-table-row key={line.id}><s-table-cell>{line.account}</s-table-cell><s-table-cell>{line.memo}</s-table-cell><s-table-cell>{formatEuros(BigInt(line.debitCents))}</s-table-cell><s-table-cell>{formatEuros(BigInt(line.creditCents))}</s-table-cell></s-table-row>)}</s-table-body></s-table></s-section>)}</s-page>;
}
