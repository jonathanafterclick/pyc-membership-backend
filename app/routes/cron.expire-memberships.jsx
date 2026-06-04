export const loader = async ({ request }) => {
    return handleCron(request);
};

export const action = async ({ request }) => {
    return handleCron(request);
};