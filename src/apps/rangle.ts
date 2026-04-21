import type { App } from "../app_reg";

export default {
    id: "rangle",
    name: "Rangle",
    hooks: {
        globalStorage: {
            write: async (user_id, key, value) => {
                // we only speak json. try to parse the json value. if it's not valid, block the write
                let data: any;
                try {
                    data = JSON.parse(value);
                    if (!data && typeof data === "object") {
                        return "Invalid value: not an object";
                    }
                } catch (e) {
                    return "Invalid value: not valid JSON";
                }

                // don't care about writes not to state past here
                if (key !== "state") {
                    return "";
                }

                // TODO: if valid, index all scores not yet seen for the leaderboards into D1
                return "";
            }
        }
    },
    routes: {
        get: {
            "/": () => {
                return new Response("Hello from Rangle!", { status: 200 });
            }
        }
    }
} satisfies App;
