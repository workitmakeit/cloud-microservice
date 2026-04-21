import type { App } from "../app_reg";

type StatPositionFlags = [boolean, boolean, boolean, boolean, boolean];

interface SaveStateDay {
    current_order_ids: string[];
    attempts: StatPositionFlags[];
    previous_guess_ids?: string[][];
    hardcore?: boolean;
    bonus_results?: Record<string, boolean>;
    updated?: string;
}

export default {
    id: "rangle",
    name: "Rangle",
    hooks: {
        globalStorage: {
            write: async (user_id, key, value, env) => {
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

                // if valid, index all scores not yet seen for the leaderboards into D1
                // we want to store the user id, the number of attempts, whether it was hardcore, and the number of correct bonus results for each day
                // we also only care about a day if its finished
                const state: Record<string, SaveStateDay> = data;
                const statements = [];

                // determine when last updated for this user, if any
                const last_updated_result = await env.CLOUD_DB.prepare(
                    `SELECT updated FROM rangle_updated WHERE user_id = ?`
                ).bind(user_id).first();

                // stored as ISO string with timezone, so can be sorted lexographically
                const last_updated = last_updated_result ? last_updated_result.updated as string : "";

                for (const [date, entry] of Object.entries(state)) {
                    if (entry.updated && entry.updated <= last_updated) {
                        // this entry has not been updated since the last write, so we can skip it
                        continue;
                    }

                    if (entry.attempts.length === 0) {
                        // no attempts, no game, skip
                        continue;
                    }

                    const finished = entry.attempts.length > 5 || entry.attempts[entry.attempts.length - 1].every(x => x);
                    if (!finished) {
                        continue;
                    }

                    const n_attempts = entry.attempts.length;
                    const hardcore = entry.hardcore || false;
                    const n_correct_bonus = entry.bonus_results ? Object.values(entry.bonus_results).filter(x => x).length : 0;

                    // n.b. bonus results will be sent in a separate write. game finishes first, then bonus served later

                    statements.push(
                        env.CLOUD_DB.prepare(
                        `INSERT INTO rangle_leaderboard (user_id, date, n_attempts, hardcore, n_correct_bonus) VALUES (?, ?, ?, ?, ?)
                         ON CONFLICT(user_id, date) DO UPDATE SET
                            n_correct_bonus = MAX(rangle_leaderboard.n_correct_bonus, excluded.n_correct_bonus)
                         `
                            // only bonus results can change after the game is committed ^^
                        ).bind(user_id, date, n_attempts, hardcore, n_correct_bonus)
                    );
                }

                if (statements.length > 0) {
                    // update the last updated time for this user to current time as ISO string with timezone
                    const now = new Date().toISOString();
                    statements.push(
                        env.CLOUD_DB.prepare(
                            `INSERT INTO rangle_updated (user_id, updated) VALUES (?, ?)
                             ON CONFLICT(user_id) DO UPDATE SET updated = excluded.updated`
                        ).bind(user_id, now)
                    );

                    // consume in batches of 1000, just in case
                    for (let i = 0; i < statements.length; i += 1000) {
                        const batch = statements.slice(i, i + 1000);
                        await env.CLOUD_DB.batch(batch);
                    }
                }

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

// TODO: move the state merging logic to the cloud, and upload day by day instead of syncing whole multiday states every attempt
