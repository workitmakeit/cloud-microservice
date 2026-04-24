import { RequestWithAuth } from "./auth";
import { list_apps } from "./app_reg";

export const delete_me = async (request: RequestWithAuth, env: Env) => {
    const {success} = await env.RATE_LIMIT_STORAGE_WRITE.limit({key: request.auth.sub});
    if (!success) {
        return new Response("Too many requests", { status: 429 });
    }

    // run all delete_me hooks
    for (const app of list_apps()) {
        const delete_me_hook = app.hooks?.delete_me;
        if (delete_me_hook) {
            console.log(`Running delete_me hook for app ${app.id}`);

            try {
                await delete_me_hook(request.auth.sub, env);
            } catch (e) {
                console.error(`Error running delete_me hook for app ${app.id}:`, e);
            }
        }
    }

    // delete all endowments for the user
    await env.CLOUD_ENDOWMENTS.delete(request.auth.sub);

    // delete all global storage for the user
    const query = `DELETE FROM globalStorage WHERE user_id = ?`;
    await env.CLOUD_DB.prepare(query).bind(request.auth.sub).run();

    return new Response(null, { status: 204 });
}
