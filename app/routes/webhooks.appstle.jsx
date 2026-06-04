import { Webhook } from "svix";

export async function loader() {
    return new Response("Appstle webhook endpoint is live", {
        status: 200,
    });
}

export async function action({ request }) {
    const payload = await request.text();

    const headers = {
        "svix-id": request.headers.get("svix-id"),
        "svix-timestamp": request.headers.get("svix-timestamp"),
        "svix-signature": request.headers.get("svix-signature"),
    };

    try {
        const wh = new Webhook(process.env.APPSTLE_WEBHOOK_SECRET);

        const event = wh.verify(payload, headers);

        console.log("APPSTLE EVENT:", event.type);

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