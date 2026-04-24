import { AutoRouter, cors, type IRequest } from "itty-router";

import { authenticate, AVAILABLE_ENDOWMENTS, check_endowment, Endowment, type RequestWithAuth } from "./auth";
import * as globalStorage from "./globalStorage";
import { goodbye_frontend } from "./goodbye";
import { delete_me } from "./delete_me";

import { get_app, get_public_app_info, register_app_routing } from "./app_reg";
import {register_apps} from "./apps";

const EXACT_ORIGINS = ["rangle.today"];
const WILDCARD_ORIGINS = ["ollieg.codes", "discordsays.com"];

const { preflight, corsify } = cors({
    origin: (origin) => {
        if (!origin || origin === "null") {
            return;
        }

        if (origin.startsWith("http://localhost")) {
            return origin;
        }

        try {
            const url = new URL(origin);
            if (url.protocol !== "https:") {
                return;
            }

            if (EXACT_ORIGINS.includes(url.hostname)) {
                return origin;
            }

            for (const wildcard of WILDCARD_ORIGINS) {
                if (url.hostname === wildcard || url.hostname.endsWith("." + wildcard)) {
                    return origin;
                }
            }

            return;
        } catch (e) {
            return;
        }
    },
    allowMethods: ["GET", "PUT", "DELETE", "OPTIONS", "POST"],
    allowHeaders: ["Authorization", "Content-Type", "X-Leaderboard-Grant"]
});

const make_auth_middleware = (env: Env) => async (request: IRequest) => {
    const {success} = await env.RATE_LIMIT_PREAUTH.limit({key: request.headers.get("CF-Connecting-IP") || "unknown"});
    if (!success) {
        return new Response("Too many requests", { status: 429 });
    }

    const auth_result = await authenticate(request, env);
    if (!auth_result.success) {
        if (auth_result.error === "NO_TOKEN") {
            return Response.redirect("https://auth.ollieg.codes/login?from=" + encodeURIComponent(request.url), 302);
        }

        // if they are checking their endowments but have none, then return an empty array instead of an error so the frontend can handle it gracefully
        if (auth_result.error === "NO_ENDOWMENTS" && request.url.includes("/endowment")) {
            (request as RequestWithAuth).auth = { sub: "", username: "", provider: "", endowments: [] };
            return null;
        }

        return new Response(`Unauthorised: ${auth_result.error}`, { status: 401 });
    }

    (request as RequestWithAuth).auth = auth_result.payload;
    return null;
}

export default {
    async fetch(request, env, ctx): Promise<Response> {
        register_apps();

        const router = AutoRouter({
            before: [preflight, make_auth_middleware(env)],
            finally: [corsify]
        });

        router
            .get("/app/:app_id", (request: RequestWithAuth) => {
                const { app_id } = request.params;

                const app = get_app(app_id);
                if (!app) {
                    return new Response("App not found", { status: 404 });
                }

                return new Response(JSON.stringify(get_public_app_info(app)), { headers: { "Content-Type": "application/json" } });
            })
            .get("/endowments", (request: RequestWithAuth) => {
                const auth = request.auth;
                return new Response(JSON.stringify(auth.endowments), { headers: { "Content-Type": "application/json" } });
            })
            .get("/endowment/:endowment", (request: RequestWithAuth) => {
                const auth = request.auth;
                const { endowment } = request.params;

                if (!AVAILABLE_ENDOWMENTS.includes(endowment as Endowment)) {
                    return new Response("Invalid endowment", { status: 400 });
                }

                return new Response(JSON.stringify(check_endowment(auth.endowments, endowment as Endowment)), { headers: { "Content-Type": "application/json" } })
            })
            .get("/globalStorage/:app_id?/:key?", globalStorage.GET)
            .put("/globalStorage/:app_id?/:key?", globalStorage.PUT)
            .delete("/globalStorage/:app_id?/:key?", globalStorage.DELETE)
            .delete("/me", delete_me)
            .get("/goodbye", goodbye_frontend);

        register_app_routing(router);

        return router.fetch(request, env, ctx);
    }
} satisfies ExportedHandler<Env>;
