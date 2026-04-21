import { RequestWithAuth } from "./auth";
import { list_apps } from "./app_reg";

export const delete_me = async (request: RequestWithAuth, env: Env) => {
    // run all delete_me hooks
    for (const app of list_apps()) {
        const delete_me_hook = app.hooks?.delete_me;
        if (delete_me_hook) {
            try {
                await delete_me_hook();
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
