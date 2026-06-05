import { authenticate } from "../shopify.server";

const ELIGIBLE_TICKET_PRODUCT_IDS = [
    "7691296505952",
    "7599940698208",
    "7514010157152",
    "7400021786720",
    "7353942638688",
    "7353931759712",
    "7344872489056",
    "7274118512736",
    "7274116186208",
    "7274110189664",
    "7265522450528",
    "7206872416352",
];

const MEMBERSHIP_VARIANT_TO_TIER = {
    "42773692481632": 1,
    "42773692514400": 2,
    "42773692547168": 3,
    "42773692579936": 4,
};

const TICKET_PRICE = 69;

const MEMBERSHIP_DISCOUNT_TITLES = [
    "Puppy Yoga Membership Credits",
    "Membership free ticket",
];

export const action = async ({ request }) => {
    const { admin, payload } = await authenticate.webhook(request);

    const customerGid = payload.customer?.admin_graphql_api_id;

    if (!admin || !customerGid) {
        return new Response();
    }

    const membershipTierFromOrder = getMembershipTierFromOrder(payload);

    if (membershipTierFromOrder > 0) {
        const isInitialMembershipPurchase = hasEligibleTicketInOrder(payload);
        const isRenewal = !isInitialMembershipPurchase;

        if (isRenewal) {
            await resetMembershipCredits(admin, customerGid, membershipTierFromOrder);

            await setCustomerDebug(admin, customerGid, {
                order: payload.name,
                action: "renewal_reset",
                tier: membershipTierFromOrder,
                creditsSetTo: membershipTierFromOrder,
                processedAt: new Date().toISOString(),
            });
        } else {
            await initializeMembership(admin, customerGid, membershipTierFromOrder);

            await setCustomerDebug(admin, customerGid, {
                order: payload.name,
                action: "initial_membership_purchase",
                tier: membershipTierFromOrder,
                creditsSetTo: 0,
                processedAt: new Date().toISOString(),
            });
        }

        return new Response();
    }

    const usedCredits = getUsedMembershipCredits(payload);

    await setCustomerDebug(admin, customerGid, {
        order: payload.name,
        action: "credit_burn",
        usedCredits,
        processedAt: new Date().toISOString(),
    });

    if (usedCredits <= 0) {
        return new Response();
    }

    const currentCredits = await getCustomerCredits(admin, customerGid);
    const newCredits = Math.max(0, currentCredits - usedCredits);

    await setCustomerCredits(admin, customerGid, newCredits);

    return new Response();
};

function getMembershipTierFromOrder(order) {
    for (const lineItem of order.line_items || []) {
        const variantId = String(lineItem.variant_id || "");

        if (MEMBERSHIP_VARIANT_TO_TIER[variantId]) {
            return MEMBERSHIP_VARIANT_TO_TIER[variantId];
        }

        const searchableTitle = [
            lineItem.title,
            lineItem.name,
            lineItem.variant_title,
            lineItem.sku,
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        if (searchableTitle.includes("includes 4 class")) return 4;
        if (searchableTitle.includes("includes 4 classes")) return 4;

        if (searchableTitle.includes("includes 3 class")) return 3;
        if (searchableTitle.includes("includes 3 classes")) return 3;

        if (searchableTitle.includes("includes 2 class")) return 2;
        if (searchableTitle.includes("includes 2 classes")) return 2;

        if (searchableTitle.includes("includes 1 class")) return 1;
        if (searchableTitle.includes("includes 1 classes")) return 1;
    }

    return 0;
}

function hasEligibleTicketInOrder(order) {
    return (order.line_items || []).some((lineItem) =>
        ELIGIBLE_TICKET_PRODUCT_IDS.includes(String(lineItem.product_id))
    );
}

function getUsedMembershipCredits(order) {
    let usedCredits = 0;

    const discountApplications = order.discount_applications || [];

    for (const lineItem of order.line_items || []) {
        const productId = String(lineItem.product_id);

        if (!ELIGIBLE_TICKET_PRODUCT_IDS.includes(productId)) {
            continue;
        }

        for (const allocation of lineItem.discount_allocations || []) {
            const discountApplication =
                discountApplications[allocation.discount_application_index];

            if (!isMembershipDiscountApplication(discountApplication)) {
                continue;
            }

            const amount = Number(allocation.amount || 0);

            if (amount <= 0) continue;

            usedCredits += Math.round(amount / TICKET_PRICE);
        }
    }

    return usedCredits;
}

function isMembershipDiscountApplication(discountApplication) {
    if (!discountApplication) return false;

    const searchableText = [
        discountApplication.title,
        discountApplication.description,
        discountApplication.code,
        discountApplication.type,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    return MEMBERSHIP_DISCOUNT_TITLES.some((title) =>
        searchableText.includes(title.toLowerCase())
    );
}

async function getCustomerCredits(admin, customerGid) {
    const response = await admin.graphql(
        `#graphql
      query GetCustomerCredits($id: ID!) {
        customer(id: $id) {
          metafield(namespace: "custom", key: "membership_credits") {
            value
          }
        }
      }
    `,
        {
            variables: {
                id: customerGid,
            },
        }
    );

    const json = await response.json();

    return Number(json.data?.customer?.metafield?.value || 0);
}

async function initializeMembership(admin, customerGid, tier) {
    const now = new Date().toISOString();

    const response = await admin.graphql(
        `#graphql
      mutation InitializeMembership($metafields: [MetafieldsSetInput!]!) {
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
                        key: "membership_credits",
                        type: "number_integer",
                        value: "0",
                    },
                    {
                        ownerId: customerGid,
                        namespace: "custom",
                        key: "membership_tier",
                        type: "number_integer",
                        value: String(tier),
                    },
                    {
                        ownerId: customerGid,
                        namespace: "custom",
                        key: "membership_status",
                        type: "single_line_text_field",
                        value: "active",
                    },
                    {
                        ownerId: customerGid,
                        namespace: "custom",
                        key: "last_membership_renewal",
                        type: "date_time",
                        value: now,
                    },
                ],
            },
        }
    );

    const json = await response.json();
    const errors = json.data?.metafieldsSet?.userErrors || [];

    if (errors.length) {
        console.error("Initialize membership errors:", errors);
    }
}

async function resetMembershipCredits(admin, customerGid, tier) {
    const now = new Date().toISOString();

    const response = await admin.graphql(
        `#graphql
      mutation ResetMembershipCredits($metafields: [MetafieldsSetInput!]!) {
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
                        key: "membership_credits",
                        type: "number_integer",
                        value: String(tier),
                    },
                    {
                        ownerId: customerGid,
                        namespace: "custom",
                        key: "membership_tier",
                        type: "number_integer",
                        value: String(tier),
                    },
                    {
                        ownerId: customerGid,
                        namespace: "custom",
                        key: "membership_status",
                        type: "single_line_text_field",
                        value: "active",
                    },
                    {
                        ownerId: customerGid,
                        namespace: "custom",
                        key: "last_membership_renewal",
                        type: "date_time",
                        value: now,
                    },
                ],
            },
        }
    );

    const json = await response.json();
    const errors = json.data?.metafieldsSet?.userErrors || [];

    if (errors.length) {
        console.error("Reset membership credits errors:", errors);
    }
}

async function setCustomerCredits(admin, customerGid, credits) {
    const response = await admin.graphql(
        `#graphql
      mutation SetCustomerCredits($metafields: [MetafieldsSetInput!]!) {
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
                        key: "membership_credits",
                        type: "number_integer",
                        value: String(credits),
                    },
                ],
            },
        }
    );

    const json = await response.json();
    const errors = json.data?.metafieldsSet?.userErrors || [];

    if (errors.length) {
        console.error("Set customer credits errors:", errors);
    }
}

async function setCustomerDebug(admin, customerGid, debugData) {
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
                        value: JSON.stringify(debugData).substring(0, 255),
                    },
                ],
            },
        }
    );
}