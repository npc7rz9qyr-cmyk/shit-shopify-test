import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";
import { formatEuros, moneyToCents } from "../services/money";
import { postExpense } from "../services/expenses.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const expenses = await prisma.expense.findMany({
    where: { shopId: shop.id },
    orderBy: { date: "desc" },
    take: 100,
    include: { journalEntry: true },
  });

  return {
    expenses: expenses.map((expense) => ({
      id: expense.id,
      date: expense.date.toISOString(),
      supplier: expense.supplier,
      description: expense.description,
      invoiceNumber: expense.invoiceNumber,
      totalCents: expense.totalCents.toString(),
      vatCents: expense.vatCents.toString(),
      entryNumber: expense.journalEntry.entryNumber,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const form = await request.formData();
  const date = new Date(`${String(form.get("date") || "")}T12:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Response("Ongeldige datum", { status: 400 });
  }

  try {
    await postExpense(shop.id, {
      date,
      supplier: String(form.get("supplier") || ""),
      description: String(form.get("description") || ""),
      invoiceNumber: String(form.get("invoiceNumber") || ""),
      netCents: moneyToCents(String(form.get("net") || "0").replace(",", ".")),
      vatCents: moneyToCents(String(form.get("vat") || "0").replace(",", ".")),
      totalCents: moneyToCents(String(form.get("total") || "0").replace(",", ".")),
    });
  } catch (error) {
    throw new Response(error instanceof Error ? error.message : String(error), {
      status: 400,
    });
  }

  return redirect("/app/expenses?saved=1");
};

type ExpenseFieldProps = {
  id: string;
  label: string;
  type?: "text" | "date" | "number";
  defaultValue?: string;
  step?: string;
  required?: boolean;
};

function ExpenseField({
  id,
  label,
  type = "text",
  defaultValue,
  step,
  required = false,
}: ExpenseFieldProps) {
  return (
    <div style={{ display: "grid", gap: "0.35rem" }}>
      <label htmlFor={id} style={{ fontWeight: 600 }}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        defaultValue={defaultValue}
        step={step}
        required={required}
        style={{
          padding: "0.65rem",
          border: "1px solid #8c9196",
          borderRadius: "0.5rem",
          width: "100%",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

export default function ExpensesPage() {
  const { expenses } = useLoaderData<typeof loader>();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <s-page heading="Kosten">
      <s-section heading="Kosten boeken">
        <Form method="post">
          <div style={{ display: "grid", gap: "0.75rem", maxWidth: "34rem" }}>
            <ExpenseField id="date" label="Datum" type="date" defaultValue={today} required />
            <ExpenseField id="supplier" label="Leverancier" required />
            <ExpenseField id="description" label="Omschrijving" required />
            <ExpenseField id="invoiceNumber" label="Factuurnummer (optioneel)" />
            <ExpenseField id="net" label="Bedrag exclusief btw" type="number" step="0.01" required />
            <ExpenseField id="vat" label="Btw" type="number" step="0.01" required />
            <ExpenseField id="total" label="Totaal betaald" type="number" step="0.01" required />
            <div>
              <s-button type="submit" variant="primary">
                Kosten boeken
              </s-button>
            </div>
          </div>
        </Form>
      </s-section>

      <s-section heading="Recente kosten">
        {expenses.length === 0 ? (
          <s-paragraph>Nog geen kosten geboekt.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Datum</s-table-header>
              <s-table-header>Leverancier</s-table-header>
              <s-table-header>Omschrijving</s-table-header>
              <s-table-header>Btw</s-table-header>
              <s-table-header>Totaal</s-table-header>
              <s-table-header>Boeking</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {expenses.map((expense) => (
                <s-table-row key={expense.id}>
                  <s-table-cell>
                    {new Date(expense.date).toLocaleDateString("nl-NL")}
                  </s-table-cell>
                  <s-table-cell>{expense.supplier}</s-table-cell>
                  <s-table-cell>{expense.description}</s-table-cell>
                  <s-table-cell>{formatEuros(BigInt(expense.vatCents))}</s-table-cell>
                  <s-table-cell>{formatEuros(BigInt(expense.totalCents))}</s-table-cell>
                  <s-table-cell>#{expense.entryNumber}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
