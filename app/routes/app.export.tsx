import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";

function csvCell(value: unknown) { const text = String(value ?? ""); return `"${text.replaceAll('"', '""')}"`; }
function decimal(cents: bigint) { const negative = cents < 0n; const amount = negative ? -cents : cents; return `${negative ? "-" : ""}${amount / 100n},${(amount % 100n).toString().padStart(2, "0")}`; }

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const entries = await prisma.journalEntry.findMany({ where: { shopId: shop.id }, orderBy: [{ date: "asc" }, { entryNumber: "asc" }], include: { lines: { include: { account: true } } } });
  const rows = [["Boeking", "Datum", "Status", "Bron", "Omschrijving", "Rekening", "Rekeningnaam", "Debet", "Credit", "Memo"], ...entries.flatMap((entry) => entry.lines.map((line) => [entry.entryNumber, entry.date.toISOString().slice(0, 10), entry.status, entry.sourceType, entry.description, line.account.code, line.account.name, decimal(line.debitCents), decimal(line.creditCents), line.memo]))];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="shopify-boekhouding-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
};
