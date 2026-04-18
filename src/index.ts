import { AutoRouter, cors, type IRequest } from "itty-router";

import { authenticate, AVAILABLE_ENDOWMENTS, check_endowment, Endowment, type RequestWithAuth } from './auth';
import * as globalStorage from "./globalStorage";

const { preflight, corsify } = cors({
    origin: "*", // TODO: restrict to allowed origins
    allowMethods: ["GET", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"]
});

const make_auth_middleware = (env: Env) => async (request: IRequest) => {
    const auth_result = await authenticate(request, env);
    if (!auth_result.success) {
        if (auth_result.error === "NO_TOKEN") {
            return Response.redirect("https://auth.ollieg.codes/login?from=" + encodeURIComponent(request.url), 302);
        }

        return new Response(`Unauthorised: ${auth_result.error}`, { status: 401 });
    }

    (request as RequestWithAuth).auth = auth_result.payload;
    return null;
}

export default {
    async fetch(request, env, ctx): Promise<Response> {
        const router = AutoRouter({
            before: [preflight, make_auth_middleware(env)],
            finally: [corsify]
        });

        router
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
            .delete("/globalStorage/:app_id?/:key?", globalStorage.DELETE);

        return router.fetch(request, env, ctx);
    }
} satisfies ExportedHandler<Env>;
