export async function loader() {
    return new Response("Appstle webhook endpoint is live", {
        status: 200,
    });
}

export async function action({ request }) {
    console.log("APPSTLE WEBHOOK RECEIVED");

    return new Response("OK", {
        status: 200,
    });
}