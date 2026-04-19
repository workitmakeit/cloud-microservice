import { RequestWithAuth } from "./auth";

export const delete_me = async (request: RequestWithAuth, env: Env) => {
    // delete all endowments for the user
    await env.CLOUD_ENDOWMENTS.delete(request.auth.sub);

    // delete all global storage for the user
    const query = `DELETE FROM globalStorage WHERE user_id = ?`;
    await env.CLOUD_DB.prepare(query).bind(request.auth.sub).run();

    return new Response(null, { status: 204 });
}
