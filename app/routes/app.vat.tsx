import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";
import { formatEuros } from "../services/money";

function defaultQuarter() {
  const now = new Date();
  const startMonth = Math.floor(now.getMonth() / 3) * 3;
  return {
    start: new Date(Date.UTC(now.getFullYear(), startMonth, 1)),
    end: new Date(
      Date.UTC(now.getFullYear(), startMonth + 3, 0, 23, 59, 59),
    ),
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const url = new URL(request.url);
  const fallback = defaultQuarter();

  const start = url.searchParams.get("start")
    ? new Date(`${url.searchParams.get("start")}T00:00:00.000Z`)
    : fallback.start;
  const end = url.searchParams.get("end")
    ? new Date(`${url.searchParams.get("end")}T23:59:59.999Z`)
    : fallback.end;

  const accounts = await prisma.ledgerAccount.findMany({
    where: {
      shopId: shop.id,
      systemKey: {
        in: ["VAT_PAYABLE", "VAT_RECEIVABLE", "SALES", "SHIPPING_REVENUE"],
      },
    },
    include: {
      lines: {
        where: {
          entry: {
            date: { gte: start, lte: end },
            status: { in: ["POSTED", "REVERSED"] },
          },
        },
      },
    },
  });

  const balance = (key: string) => {
    const account = accounts.find((item) => item.systemKey === key);
    return account
      ? account.lines.reduce(
          (sum, line) => sum + line.creditCents - line.debitCents,
          0n,
        )
      : 0n;
  };

  const payable = balance("VAT_PAYABLE");
  const receivable = -balance("VAT_RECEIVABLE");
  const revenue = balance("SALES") + balance("SHIPPING_REVENUE");

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    payable: payable.toString(),
    receivable: receivable.toString(),
    net: (payable - receivable).toString(),
    revenue: revenue.toString(),
  };
};

export default function VatPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Btw-overzicht">
      <s-section heading="Periode">
        <Form method="get">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))",
              gap: "0.75rem",
              alignItems: "end",
              maxWidth: "42rem",
            }}
          >
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <label htmlFor="start" style={{ fontWeight: 600 }}>
                Van
              </label>
              <input
                id="start"
                name="start"
                type="date"
                defaultValue={data.start}
                required
                style={{
                  padding: "0.65rem",
                  border: "1px solid #8c9196",
                  borderRadius: "0.5rem",
                }}
              />
            </div>

            <div style={{ display: "grid", gap: "0.35rem" }}>
              <label htmlFor="end" style={{ fontWeight: 600 }}>
                Tot en met
              </label>
              <input
                id="end"
                name="end"
                type="date"
                defaultValue={data.end}
                required
                style={{
                  padding: "0.65rem",
                  border: "1px solid #8c9196",
                  borderRadius: "0.5rem",
                }}
              />
            </div>

            <div>
              <s-button type="submit">Berekenen</s-button>
            </div>
          </div>
        </Form>
      </s-section>

      <s-section heading="Voorlopige berekening">
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "12rem 1fr",
            gap: "0.5rem 1rem",
            margin: "0 0 1rem",
          }}
        >
          <dt style={{ fontWeight: 600 }}>Netto omzet</dt>
          <dd style={{ margin: 0 }}>{formatEuros(BigInt(data.revenue))}</dd>
          <dt style={{ fontWeight: 600 }}>Af te dragen btw</dt>
          <dd style={{ margin: 0 }}>{formatEuros(BigInt(data.payable))}</dd>
          <dt style={{ fontWeight: 600 }}>Voorbelasting</dt>
          <dd style={{ margin: 0 }}>{formatEuros(BigInt(data.receivable))}</dd>
          <dt style={{ fontWeight: 600 }}>Per saldo</dt>
          <dd style={{ margin: 0 }}>{formatEuros(BigInt(data.net))}</dd>
        </dl>

        <s-banner tone="warning">
          Dit MVP-overzicht bundelt alle btw. Controleer gemengde tarieven,
          EU/OSS en uitzonderingen vóór aangifte.
        </s-banner>
      </s-section>
    </s-page>
  );
}
