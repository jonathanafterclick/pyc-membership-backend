import { unauthenticated } from "../shopify.server";

const MEMBERSHIP_VALID_DAYS = 33;
const PAGE_SIZE = 100;

export const loader = async ({ request }) => {
    return handleCron(request);
};

export const action = async ({ request }) => {
    return handleCron(request);
};

async function handleCron(request) {
    const url = new URL(request.url);
    const secret = url.searchParams.get("secret");

    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
        return new Response("Unauthorized", { status: 401 });
    }

    const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;

    if (!shopDomain) {
        return new Response("Missing SHOPIFY_SHOP_DOMAIN", { status: 500 });
    }

    const { admin } = await unauthenticated.admin(shopDomain);

    let after = null;
    let scanned = 0;
    let expired = 0;

    while (true) {
        const { customers, pageInfo } = await fetchCustomers(admin, after);

        for (const customer of customers) {
            scanned += 1;

            const status = String(
                customer.membershipStatus?.value || ""
            ).toLowerCase();

            const credits = Number(customer.membershipCredits?.value || 0);
            const tier = Number(customer.membershipTier?.value || 0);
            const lastRenewal = customer.lastMembershipRenewal?.value;

            if (status !== "active") continue;
            if (tier <= 0 && credits <= 0) continue;
            if (!isExpired(lastRenewal)) continue;

            await expireCustomerMembership(admin, customer.id, {
                previousStatus: status,
                previousCredits: credits,
                previousTier: tier,
                lastRenewal,
            });

            expired += 1;
        }

        if (!pageInfo.hasNextPage) break;

        after = pageInfo.endCursor;
    }

    return Response.json({
        ok: true,
        scanned,
        expired,
        processedAt: new Date().toISOString(),
    });
}

async function fetchCustomers(admin, after) {
    const response = await admin.graphql(
        `#graphql
      query FetchCustomers($first: Int!, $after: String) {
        customers(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            email
            membershipStatus: metafield(namespace: "custom", key: "membership_status") {
              value
            }
            membershipTier: metafield(namespace: "custom", key: "membership_tier") {
              value
            }
            membershipCredits: metafield(namespace: "custom", key: "membership_credits") {
              value
            }
            lastMembershipRenewal: metafield(namespace: "custom", key: "last_membership_renewal") {
              value
            }
          }
        }
      }
    `,
        {
            variables: {
                first: PAGE_SIZE,
                after,
            },
        }
    );

    const json = await response.json();

    return {
        customers: json.data?.customers?.nodes || [],
        pageInfo: json.data?.customers?.pageInfo || {
            hasNextPage: false,
            endCursor: null,
        },
    };
}

function isExpired(lastRenewalValue) {
    if (!lastRenewalValue) return true;

    const lastRenewalDate = new Date(lastRenewalValue);

    if (Number.isNaN(lastRenewalDate.getTime())) {
        return true;
    }

    const expiresAt = new Date(lastRenewalDate);
    expiresAt.setDate(expiresAt.getDate() + MEMBERSHIP_VALID_DAYS);

    return new Date() > expiresAt;
}

async function expireCustomerMembership(admin, customerId, previousData) {
    const now = new Date().toISOString();

    const response = await admin.graphql(
        `#graphql
      mutation ExpireMembership($metafields: [MetafieldsSetInput!]!) {
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
                        ownerId: customerId,
                        namespace: "custom",
                        key: "membership_status",
                        type: "single_line_text_field",
                        value: "cancelled",
                    },
                    {
                        ownerId: customerId,
                        namespace: "custom",
                        key: "membership_credits",
                        type: "number_integer",
                        value: "0",
                    },
                    {
                        ownerId: customerId,
                        namespace: "custom",
                        key: "membership_tier",
                        type: "number_integer",
                        value: "0",
                    },
                    {
                        ownerId: customerId,
                        namespace: "custom",
                        key: "last_credit_burn_debug",
                        type: "single_line_text_field",
                        value: JSON.stringify({
                            action: "membership_expired_after_grace_period",
                            previousStatus: previousData.previousStatus,
                            previousCredits: previousData.previousCredits,
                            previousTier: previousData.previousTier,
                            lastRenewal: previousData.lastRenewal,
                            processedAt: now,
                        }).substring(0, 255),
                    },
                ],
            },
        }
    );

    const json = await response.json();
    const errors = json.data?.metafieldsSet?.userErrors || [];

    if (errors.length) {
        console.error("Expire membership errors:", errors);
    }
}