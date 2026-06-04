import { Webhook } from "svix";
import { unauthenticated } from "../shopify.server";

export async function loader() {
    return new Response("Appstle webhook endpoint is live", {
        status: 200,
    });
}

export async function action({ request }) {
    const payload = await request.text();

    try {
        const wh = new Webhook(process.env.APPSTLE_WEBHOOK_SECRET);
        const headers = Object.fromEntries(request.headers.entries());
        const event = wh.verify(payload, headers);

        console.log("APPSTLE EVENT:", event.type);
        console.log("APPSTLE STATUS:", event.data?.status);
        console.log("APPSTLE CUSTOMER:", event.data?.customer?.id);

        const isCancellation =
            event.type === "subscription.cancelled" ||
            (event.type === "subscription.updated" &&
                event.data?.status === "CANCELLED");

        if (!isCancellation) {
            return new Response("OK", { status: 200 });
        }

        const customerGid = event.data?.customer?.id;

        if (!customerGid) {
            console.error("APPSTLE CANCEL ERROR: Missing customer ID");
            return new Response("Missing customer ID", { status: 200 });
        }

        const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;

        if (!shopDomain) {
            console.error("APPSTLE CANCEL ERROR: Missing SHOPIFY_SHOP_DOMAIN");
            return new Response("Missing shop domain", { status: 200 });
        }

        const { admin } = await unauthenticated.admin(shopDomain);

        await cancelMembership(admin, customerGid);

        console.log("APPSTLE CANCEL PROCESSED:", customerGid);

        return new Response("OK", { status: 200 });
    } catch (error) {
        console.error("WEBHOOK ERROR:", error);

        return new Response("Invalid signature", {
            status: 400,
        });
    }
}

async function cancelMembership(admin, customerGid) {
    const response = await admin.graphql(
        `#graphql
      mutation CancelMembership($metafields: [MetafieldsSetInput!]!) {
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
                        key: "membership_status",
                        type: "single_line_text_field",
                        value: "cancelled",
                    },
                    {
                        ownerId: customerGid,
                        namespace: "custom",
                        key: "membership_credits",
                        type: "number_integer",
                        value: "0",
                    },
                    {
                        ownerId: customerGid,
                        namespace: "custom",
                        key: "membership_tier",
                        type: "number_integer",
                        value: "0",
                    },
                ],
            },
        }
    );

    const json = await response.json();
    const errors = json.data?.metafieldsSet?.userErrors || [];

    if (errors.length) {
        console.error("Cancel membership metafield errors:", errors);
    }
}