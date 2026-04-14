import { parseCookie } from "cookie";
import type { IRequest } from "itty-router";

interface JWTPayload {
    sub: string;
    username: string;
    discriminator?: string;
    email?: string;
    avatar?: string;
}

export type Endowment =
    "*" |
        "auth" |
        "globalStorage:*" |
            "globalStorage:read" |
            "globalStorage:write";

export const check_endowment = (endowments: Endowment[], required: Endowment) => {
    // if they have the global wildcard, no questions asked
    if (endowments.includes("*")) {
        return true;
    }

    // if they have the wildcard for the category, cool
    if (required.includes(":")) {
        const [category] = required.split(":");
        if (endowments.includes(category + ":*" as Endowment)) {
            return true;
        }
    }

    return endowments.includes(required);
}

interface AuthServiceRPC {
    get_provider_names(): string;
    verify_token(token: string): Promise<{ valid: true; payload: JWTPayload } | { valid: false }>;
}

export type RequestWithAuth = IRequest & { auth: JWTPayload & { endowments: Endowment[] } };

type AuthError = "NO_TOKEN" | "NO_ENDOWMENTS" | "INSUFFICIENT_ENDOWMENTS";
type AuthResult = { success: true; payload: JWTPayload & { endowments: Endowment[] } } | { success: false; error: AuthError };

export const authenticate = async (request: IRequest, env: Env): Promise<AuthResult> => {
    // get sso_token cookie
    const cookie_header = request.headers.get("Cookie");
    const sso_token = cookie_header ? parseCookie(cookie_header)["sso_token"] : null;

    if (!sso_token) {
        return { success: false, error: "NO_TOKEN" };
    }

    const auth_service = env.AUTH_SERVICE as unknown as AuthServiceRPC;
    const verification_result = await auth_service.verify_token(sso_token);

    if (!verification_result.valid) {
        return { success: false, error: "NO_TOKEN" };
    }

    const {payload} = verification_result;
    const endowments_str = await env.CLOUD_ENDOWMENTS.get(payload.sub);

    if (!endowments_str) {
        return { success: false, error: "NO_ENDOWMENTS" };
    }

    const endowments = endowments_str.split(",") as Endowment[];

    if (!check_endowment(endowments, "auth")) {
        return { success: false, error: "INSUFFICIENT_ENDOWMENTS" };
    }

    return {
        success: true,
        payload: {
            ...payload,
            endowments
        }
    };
}
