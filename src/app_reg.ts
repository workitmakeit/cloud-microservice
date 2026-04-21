import type { Endowment, RequestWithAuth } from "./auth";
import type { AutoRouterType, IRequest } from "itty-router";

/**
 * A hook that runs when globalStorage writes are invoked for this app.
 * @param user_id The ID of the user performing the write (JWT sub, prefixed with provider, e.g. discord:123456789)
 * @param key The key being written to
 * @param value The value being written
 * @param env The environment object
 * @returns If the hook returns an empty string, the write will proceed as normal. If it returns a non-empty string, the write will be blocked and the client will receive an error with the returned string as the message.
 */
export type GlobalStorageWriteHook = (user_id: string, key: string, value: string, env: Env) => Promise<string>;

/**
 * A hook that runs when globalStorage delete is invoked for this app.
 * @param user_id The ID of the user performing the write (JWT sub, prefixed with provider, e.g. discord:123456789)
 * @param key The key being deleted, or null if all keys for the app are being deleted
 * @param env The environment object
 * @returns If the hook returns an empty string, the delete will proceed as normal. If it returns a non-empty string, the delete will be blocked and the client will receive an error with the returned string as the message.
 */
export type GlobalStorageDeleteHook = (user_id: string, key: string | null, env: Env) => Promise<string>;

/**
 * A hook that runs when the user deletes their account. Apps must clean up all of their data to comply with protection regulations.
 * This hook is run BEFORE endowments and globalStorage are cleared for the user.
 * @param user_id The ID of the user deleting their account (JWT sub, prefixed with provider, e.g. discord:123456789)
 * @param env The environment object
 */
export type DeleteMeHook = (user_id: string, env: Env) => Promise<void>;

type HTTPMethod = "get" | "post" | "put" | "delete" | "patch";

/**
 * A registered app with cloud storage.
 */
export interface App {
    /** Unique identifier for the app, used as a route parameter. */
    id: string;

    /** Friendly name of the app, shown to users. */
    name: string;

    /** Optional description of the app, shown to users. */
    description?: string;

    /** Optional URL of the app's icon, shown to users. Should be a square image for best results. */
    icon_url?: string;

    /** Optional hooks that run when certain actions are performed. */
    hooks?: {
        /** Any app that stores data outside of globalStorage must implement this! */
        delete_me?: () => Promise<void>;


        globalStorage?: {
            write?: GlobalStorageWriteHook;
            delete?: GlobalStorageDeleteHook;
        }
    }

    /** Extra endowments the app requires beyond the standard ones. If any of these are missing, the user will not be able to use the app for the specified function. */
    extra_endowments?: {
        all?: Endowment[];
        globalStorage?: {
            read?: Endowment[];
            write?: Endowment[];
            delete?: Endowment[];
        }
    }

    /**
     * Optional custom routes that the app can handle. Keyed by method (lowercase) then by route. Values are the route handler functions.
     * Route parameters should be specified with :param in the route string, and will be passed to the handler in request.params.
     * Note that the route will be prefixed with the app ID, so a route of "/foo" for an app with ID "myapp" will be available at "/myapp/foo".
     */
    routes?: Partial<Record<HTTPMethod, {
        [route: string]: (request: RequestWithAuth, env: Env) => Promise<Response> | Response;
    }>>;
}

const app_reg = new Map<string, App>();

export const get_app = (app_id: string): App | undefined => {
    return app_reg.get(app_id);
}

const ILLEGAL_APP_IDS = new Set(["app", "globalStorage", "endowment", "endowments", "me", "goodbye"]);

export const register_app = (app: App) => {
    if (ILLEGAL_APP_IDS.has(app.id)) {
        throw new Error(`App ID ${app.id} is reserved and cannot be used`);
    }

    if (app_reg.has(app.id)) {
        throw new Error(`App with ID ${app.id} is already registered`);
    }

    app_reg.set(app.id, app);
    console.log(`Registered app ${app.id}`);
}

export const list_apps = (): App[] => {
    return Array.from(app_reg.values());
}

export const list_app_ids = (): string[] => {
    return Array.from(app_reg.keys());
}

export const get_public_app_info = (app: App) => {
    const { id, name, description, icon_url } = app;
    return { id, name, description, icon_url };
}

export const register_app_routing = (router: AutoRouterType<IRequest, [], any>) => {
    for (const app of app_reg.values()) {
        if (!app.routes) {
            continue;
        }

        for (const method in app.routes) {
            const routes = app.routes[method as HTTPMethod];
            const add_route = router[method];
            for (const route in routes) {
                const handler = routes[route];
                const normalised_route = `/${app.id}${route.startsWith("/") ? route : "/" + route}`;
                add_route(normalised_route, handler);
            }
        }
    }
}
