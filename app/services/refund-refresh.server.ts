import { normalizeGraphqlOrder } from "./order-normalizer.server";
import { postOrder } from "./accounting.server";

type AdminGraphqlContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const ORDER_QUERY = `#graphql
  query AccountingOrder($id: ID!) {
    order(id: $id) {
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
`;

export async function importSingleOrder(
  admin: AdminGraphqlContext,
  shopId: string,
  orderId: string,
) {
  const response = await admin.graphql(ORDER_QUERY, {
    variables: { id: orderId },
  });
  const body = (await response.json()) as {
    data?: { order?: Parameters<typeof normalizeGraphqlOrder>[0] | null };
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) {
    throw new Error(body.errors.map((error) => error.message).join("; "));
  }
  if (!body.data?.order) throw new Error(`Order niet gevonden: ${orderId}`);
  return postOrder(shopId, normalizeGraphqlOrder(body.data.order));
}
