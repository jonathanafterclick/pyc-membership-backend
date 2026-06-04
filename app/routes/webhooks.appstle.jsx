export async function action({ request }) {
    console.log("APPSTLE WEBHOOK RECEIVED");

    return new Response("OK", {
        status: 200,
    });
}