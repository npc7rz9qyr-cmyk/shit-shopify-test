import prisma from "../db.server";
import { postOrder } from "./accounting.server";
import { normalizeGraphqlOrder } from "./order-normalizer.server";

type AdminGraphqlContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const ORDERS_QUERY = `#graphql
  query AccountingOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, sortKey: PROCESSED_AT, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
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

export async function importOrders(
  admin: AdminGraphqlContext,
  shopId: string,
  startDate: Date,
) {
  const run = await prisma.importRun.create({
    data: { shopId, type: "ORDERS", startedAt: new Date() },
  });

  let after: string | null = null;
  let imported = 0;
  let failed = 0;

  try {
    do {
      const response = await admin.graphql(ORDERS_QUERY, {
        variables: {
          first: 50,
          after,
          query: `processed_at:>=${startDate.toISOString().slice(0, 10)}`,
        },
      });
      const body = (await response.json()) as {
        data?: {
          orders?: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: Array<Parameters<typeof normalizeGraphqlOrder>[0]>;
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
      if (!connection.pageInfo.hasNextPage) break;
    } while (after);

    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: failed ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
        importedCount: imported,
        failedCount: failed,
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
