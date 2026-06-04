import { Webhook } from "svix";

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

        return new Response("OK", {
            status: 200,
        });
    } catch (error) {
        console.error("WEBHOOK ERROR:", error);

        return new Response("Invalid signature", {
            status: 400,
        });
    }
}