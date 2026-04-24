import { check_endowment, RequestWithAuth } from "./auth";
import { get_app } from "./app_reg";

// TODO: restrict to origins associated with the app ID

export const GET = async (request: RequestWithAuth, env: Env) => {
    const {success} = await env.RATE_LIMIT_STORAGE_READ.limit({key: request.auth.sub});
    if (!success) {
        return new Response("Too many requests", { status: 429 });
    }

    const {app_id, key} = request.params;

    if (!app_id) {
        return new Response("Missing app ID", { status: 400 });
    }

    if (!key) {
        return new Response("Missing key query parameter", { status: 400 });
    }

    const app = get_app(app_id);
    if (!app) {
        return new Response("Invalid app ID", { status: 400 });
    }

    if (!check_endowment(request.auth.endowments, "globalStorage:read")) {
        return new Response("Unauthorised: missing globalStorage:read endowment", { status: 403 });
    }

    if (app.extra_endowments?.all) {
        for (const endowment of app.extra_endowments.all) {
            if (!check_endowment(request.auth.endowments, endowment)) {
                return new Response(`Unauthorised: missing ${endowment} endowment`, { status: 403 });
            }
        }
    }

    if (app.extra_endowments?.globalStorage?.read) {
        for (const endowment of app.extra_endowments.globalStorage.read) {
            if (!check_endowment(request.auth.endowments, endowment)) {
                return new Response(`Unauthorised: missing ${endowment} endowment`, { status: 403 });
            }
        }
    }

    // access the database
    const query = `SELECT value FROM globalStorage WHERE user_id = ? AND app_id = ? AND key = ?`;
    const result = await env.CLOUD_DB.prepare(query).bind(request.auth.sub, app_id, key).first();

    if (!result) {
        return new Response("Not found", { status: 404 });
    }

    return new Response(result.value as string, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export const PUT = async (request: RequestWithAuth, env: Env) => {
    const {success} = await env.RATE_LIMIT_STORAGE_WRITE.limit({key: request.auth.sub});
    if (!success) {
        return new Response("Too many requests", { status: 429 });
    }

    const {app_id, key} = request.params;
    const value = await request.text();

    if (!app_id) {
        return new Response("Missing app ID", { status: 400 });
    }

    if (!key) {
        return new Response("Missing key query parameter", { status: 400 });
    }

    const app = get_app(app_id);
    if (!app) {
        return new Response("Invalid app ID", { status: 400 });
    }

    if (!check_endowment(request.auth.endowments, "globalStorage:write")) {
        return new Response("Unauthorised: missing globalStorage:write endowment", { status: 403 });
    }

    if (app.extra_endowments?.all) {
        for (const endowment of app.extra_endowments.all) {
            if (!check_endowment(request.auth.endowments, endowment)) {
                return new Response(`Unauthorised: missing ${endowment} endowment`, { status: 403 });
            }
        }
    }

    if (app.extra_endowments?.globalStorage?.write) {
        for (const endowment of app.extra_endowments.globalStorage.write) {
            if (!check_endowment(request.auth.endowments, endowment)) {
                return new Response(`Unauthorised: missing ${endowment} endowment`, { status: 403 });
            }
        }
    }

    const write_hook = app.hooks?.globalStorage?.write;
    if (write_hook) {
        console.log(`Running globalStorage write hook for app ${app.id} with key ${key} and value ${value}`);

        const error = await write_hook(request.auth.sub, key, value, env);
        if (error) {
            return new Response(error, { status: 400 });
        }
    }

    // upsert into the database
    const query = `
        INSERT INTO globalStorage (user_id, app_id, key, value) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, app_id, key) DO UPDATE SET value = excluded.value
    `;
    await env.CLOUD_DB.prepare(query).bind(request.auth.sub, app_id, key, value).run();

    return new Response(null, { status: 204 });
}

export const DELETE = async (request: RequestWithAuth, env: Env) => {
    const {success} = await env.RATE_LIMIT_STORAGE_WRITE.limit({key: request.auth.sub});
    if (!success) {
        return new Response("Too many requests", { status: 429 });
    }

    const {app_id, key} = request.params;

    if (!app_id) {
        return new Response("Missing app ID", { status: 400 });
    }

    // key is optional. if not specified, delete all keys for the app

    const app = get_app(app_id);
    if (!app) {
        return new Response("Invalid app ID", { status: 400 });
    }

    if (!check_endowment(request.auth.endowments, "globalStorage:write")) {
        return new Response("Unauthorised: missing globalStorage:write endowment", { status: 403 });
    }

    if (app.extra_endowments?.all) {
        for (const endowment of app.extra_endowments.all) {
            if (!check_endowment(request.auth.endowments, endowment)) {
                return new Response(`Unauthorised: missing ${endowment} endowment`, { status: 403 });
            }
        }
    }

    if (app.extra_endowments?.globalStorage?.delete) {
        for (const endowment of app.extra_endowments.globalStorage.delete) {
            if (!check_endowment(request.auth.endowments, endowment)) {
                return new Response(`Unauthorised: missing ${endowment} endowment`, { status: 403 });
            }
        }
    }

    const delete_hook = app.hooks?.globalStorage?.delete;
    if (delete_hook) {
        console.log(`Running globalStorage delete hook for app ${app.id} with key ${key || "ALL KEYS"}`);

        const error = await delete_hook(request.auth.sub, key || null, env);
        if (error) {
            return new Response(error, { status: 400 });
        }
    }

    let query: string;
    let params: (string | number)[];
    if (key) {
        query = `DELETE FROM globalStorage WHERE user_id = ? AND app_id = ? AND key = ?`;
        params = [request.auth.sub, app_id, key];
    } else {
        query = `DELETE FROM globalStorage WHERE user_id = ? AND app_id = ?`;
        params = [request.auth.sub, app_id];
    }

    await env.CLOUD_DB.prepare(query).bind(...params).run();

    return new Response(null, { status: 204 });
}

// TODO: run hooks in a transaction just in case
