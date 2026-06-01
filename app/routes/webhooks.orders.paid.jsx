import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
    const { admin, payload } = await authenticate.webhook(request);

    const customerGid = payload.customer?.admin_graphql_api_id;

    if (!admin || !customerGid) {
        return new Response();
    }

    const debugMessage = JSON.stringify({
        order: payload.name,
        customer: customerGid,
        discountApplications: payload.discount_applications?.length || 0,
        lineItems: payload.line_items?.length || 0,
        processedAt: new Date().toISOString(),
    });

    await admin.graphql(
        `#graphql
      mutation SetDebug($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors {
            field
            message
          }
        }
      }
    `,
        {
            variables: {
                metafields: [
                    {
                        ownerId: customerGid,
                        namespace: "custom",
                        key: "last_credit_burn_debug",
                        type: "single_line_text_field",
                        value: debugMessage.substring(0, 255),
                    },
                ],
            },
        }
    );

    return new Response();
};