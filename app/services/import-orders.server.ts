import prisma from "../db.server";
import { postOrder } from "./accounting.server";
import { normalizeGraphqlOrder } from "./order-normalizer.server";

type AdminGraphqlContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const ORDERS_QUERY = `#graphql
  query AccountingOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        createdAt
        processedAt
        currencyCode
        currentSubtotalPriceSet { shopMoney { amount currencyCode } }
        currentTotalTaxSet { shopMoney { amount currencyCode } }
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        currentTotalDiscountsSet { shopMoney { amount currencyCode } }
        currentShippingPriceSet { shopMoney { amount currencyCode } }
        taxesIncluded
        refunds {
          id
          totalRefundedSet { shopMoney { amount currencyCode } }
          refundLineItems(first: 100) {
            nodes {
              subtotalSet { shopMoney { amount currencyCode } }
              totalTaxSet { shopMoney { amount currencyCode } }
            }
          }
        }
      }
    }
  }
`;

type GraphqlOrder = Parameters<typeof normalizeGraphqlOrder>[0] & {
  createdAt?: string | null;
  processedAt?: string | null;
};

function orderDate(order: GraphqlOrder) {
  return new Date(order.createdAt || order.processedAt || new Date().toISOString());
}

function isInPeriod(order: GraphqlOrder, startDate: Date, endDate?: Date) {
  const date = orderDate(order);
  return date >= startDate && (!endDate || date <= endDate);
}

function isOlderThanPeriod(order: GraphqlOrder, startDate: Date) {
  return orderDate(order) < startDate;
}

export async function importOrders(
  admin: AdminGraphqlContext,
  shopId: string,
  startDate: Date,
  endDate?: Date,
) {
  const run = await prisma.importRun.create({
    data: { shopId, type: "ORDERS", startedAt: new Date() },
  });

  let after: string | null = null;
  let imported = 0;
  let failed = 0;
  let reachedOlderOrders = false;
  let scanned = 0;

  try {
    do {
      const response = await admin.graphql(ORDERS_QUERY, {
        variables: {
          first: 100,
          after,
        },
      });
      const body = (await response.json()) as {
        data?: {
          orders?: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: Array<GraphqlOrder>;
          };
        };
        errors?: Array<{ message: string }>;
      };

      if (body.errors?.length) {
        throw new Error(body.errors.map((error) => error.message).join("; "));
      }

      const connection = body.data?.orders;
      if (!connection) throw new Error("Shopify gaf geen orders terug");

      for (const order of connection.nodes) {
        scanned += 1;

        if (isOlderThanPeriod(order, startDate)) {
          reachedOlderOrders = true;
          continue;
        }

        if (!isInPeriod(order, startDate, endDate)) {
          continue;
        }

        try {
          await postOrder(shopId, normalizeGraphqlOrder(order));
          imported += 1;
        } catch (error) {
          failed += 1;
          await prisma.syncError.create({
            data: {
              shopId,
              sourceType: "SHOPIFY_ORDER",
              sourceId: order.id,
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }

      after = connection.pageInfo.endCursor;
      if (!connection.pageInfo.hasNextPage || reachedOlderOrders) break;
    } while (after);

    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: failed ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
        importedCount: imported,
        failedCount: failed,
        error: imported === 0 ? `Geen orders gevonden in gekozen periode na ${scanned} gescande Shopify-orders.` : null,
      },
    });

    return { imported, failed };
  } catch (error) {
    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "FAILED",
        importedCount: imported,
        failedCount: failed,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
