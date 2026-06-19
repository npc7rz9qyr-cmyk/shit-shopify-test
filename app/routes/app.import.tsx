import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../services/shop.server";
import { importOrders } from "../services/import-orders.server";

const ACCESS_SCOPES_QUERY = `#graphql
  query GrantedAccessScopes {
    appInstallation {
      accessScopes {
        handle
      }
    }
  }
`;

function safeYear(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  const currentYear = new Date().getFullYear();
  return Number.isInteger(parsed) && parsed >= 2020 && parsed <= 2100
    ? parsed
    : currentYear;
}

function safeQuarter(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  const currentQuarter = Math.floor(new Date().getMonth() / 3) + 1;
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4
    ? parsed
    : currentQuarter;
}

function quarterRange(year: number, quarter: number) {
  const startMonth = (quarter - 1) * 3;
  return {
    start: new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999)),
  };
}

function olderThanDefaultOrderWindow(date: Date) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  cutoff.setHours(0, 0, 0, 0);
  return date < cutoff;
}

async function grantedScopes(admin: { graphql: (query: string) => Promise<Response> }) {
  const response = await admin.graphql(ACCESS_SCOPES_QUERY);
  const body = (await response.json()) as {
    data?: { appInstallation?: { accessScopes?: Array<{ handle: string }> } };
    errors?: Array<{ message: string }>;
  };

  if (body.errors?.length) {
    throw new Error(body.errors.map((error) => error.message).join("; "));
  }

  return (body.data?.appInstallation?.accessScopes || []).map((scope) => scope.handle);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const formData = await request.formData();
  const year = safeYear(formData.get("year"));
  const quarter = safeQuarter(formData.get("quarter"));
  const { start, end } = quarterRange(year, quarter);
  const redirectParams = `year=${year}&quarter=${quarter}`;

  try {
    const scopes = await grantedScopes(admin);

    if (olderThanDefaultOrderWindow(start) && !scopes.includes("read_all_orders")) {
      const message = encodeURIComponent(
        `Shopify geeft deze app nog geen read_all_orders toegang. Toegekende scopes: ${scopes.join(", ") || "geen"}. Vraag read_all_orders aan/keur die goed in Partner Dashboard, deploy Shopify config opnieuw en installeer de app opnieuw.`,
      );
      return redirect(`/app/orders?${redirectParams}&error=${message}`);
    }

    const result = await importOrders(admin, shop.id, start, end);
    return redirect(
      `/app/orders?${redirectParams}&imported=${result.imported}&failed=${result.failed}&start=${start.toISOString().slice(0, 10)}&end=${end.toISOString().slice(0, 10)}`,
    );
  } catch (error) {
    const message = encodeURIComponent(
      error instanceof Error ? error.message : String(error),
    );
    return redirect(`/app/orders?${redirectParams}&error=${message}`);
  }
};

export const loader = async () => redirect("/app");
