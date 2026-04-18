import { check_endowment, RequestWithAuth } from "./auth";
import { ALLOWED_APP_IDS } from "./apps";

// TODO: restrict to origins associated with the app ID

export const GET = async (request: RequestWithAuth, env: Env) => {
    const {app_id, key} = request.params;

    if (!app_id) {
        return new Response("Missing app ID", { status: 400 });
    }

    if (!key) {
        return new Response("Missing key query parameter", { status: 400 });
    }

    if (!ALLOWED_APP_IDS.includes(app_id)) {
        return new Response("Invalid app ID", { status: 400 });
    }

    if (!check_endowment(request.auth.endowments, "globalStorage:read")) {
        return new Response("Unauthorised: missing globalStorage endowment", { status: 403 });
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
    const {app_id, key} = request.params;
    const value = await request.text();

    if (!app_id) {
        return new Response("Missing app ID", { status: 400 });
    }

    if (!key) {
        return new Response("Missing key query parameter", { status: 400 });
    }

    if (!ALLOWED_APP_IDS.includes(app_id)) {
        return new Response("Invalid app ID", { status: 400 });
    }

    if (!check_endowment(request.auth.endowments, "globalStorage:write")) {
        return new Response("Unauthorised: missing globalStorage:write endowment", { status: 403 });
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
    const {app_id, key} = request.params;

    if (!app_id) {
        return new Response("Missing app ID", { status: 400 });
    }

    // key is optional. if not specified, delete all keys for the app

    if (!ALLOWED_APP_IDS.includes(app_id)) {
        return new Response("Invalid app ID", { status: 400 });
    }

    if (!check_endowment(request.auth.endowments, "globalStorage:write")) {
        return new Response("Unauthorised: missing globalStorage:write endowment", { status: 403 });
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
