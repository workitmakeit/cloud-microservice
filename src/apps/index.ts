import { register_app } from "../app_reg";

import rangle from "./rangle";

// in dev mode the singleton often retains state, so guard to ensure apps are only registered once
let reg_guard = false;

export const register_apps = () => {
    if (reg_guard) {
        return;
    }
    reg_guard = true;

    register_app(rangle);
}
