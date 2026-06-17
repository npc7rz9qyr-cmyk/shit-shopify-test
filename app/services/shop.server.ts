import prisma from "../db.server";
import { ensureDefaultChart } from "./chart.server";

type AdminGraphqlContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export async function ensureShop(
  shopDomain: string,
  admin?: AdminGraphqlContext,
) {
  let currency = "EUR";
  let countryCode = "NL";
  let timezone = "Europe/Amsterdam";

  if (admin) {
    try {
      const response = await admin.graphql(`#graphql
        query ShopIdentity {
          shop {
            currencyCode
            billingAddress { countryCodeV2 }
            ianaTimezone
          }
        }
      `);
      const payload = (await response.json()) as {
        data?: {
          shop?: {
            currencyCode?: string;
            billingAddress?: { countryCodeV2?: string | null } | null;
            ianaTimezone?: string | null;
          };
        };
      };
      currency = payload.data?.shop?.currencyCode || currency;
      countryCode =
        payload.data?.shop?.billingAddress?.countryCodeV2 || countryCode;
      timezone = payload.data?.shop?.ianaTimezone || timezone;
    } catch {
      // De app blijft bruikbaar als de shop-identiteitsquery tijdelijk faalt.
    }
  }

  const shop = await prisma.shop.upsert({
    where: { domain: shopDomain },
    update: {
      currency,
      countryCode,
      timezone,
      uninstalledAt: null,
    },
    create: {
      domain: shopDomain,
      currency,
      countryCode,
      timezone,
      settings: {
        create: {
          bookkeepingStart: new Date(new Date().getFullYear(), 0, 1),
        },
      },
    },
    include: { settings: true },
  });

  await ensureDefaultChart(shop.id);
  return shop;
}
