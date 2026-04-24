import type { App } from "../app_reg";
import { jwtVerify, SignJWT } from "jose";

type StatPositionFlags = [boolean, boolean, boolean, boolean, boolean];

interface SaveStateDay {
    current_order_ids: string[];
    attempts: StatPositionFlags[];
    previous_guess_ids?: string[][];
    hardcore?: boolean;
    bonus_results?: Record<string, boolean>;
    updated?: string;
}

interface MiniGuild {
    name: string;
    icon?: string
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

                    const finished_correctly = entry.attempts[entry.attempts.length - 1].every(x => x);
                    const finished = finished_correctly || entry.attempts.length === 5;
                    if (!finished) {
                        continue;
                    }

                    const n_attempts = finished_correctly ? entry.attempts.length : 6;
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
        },
        delete_me: async (user_id, env) => {
            // delete all entries for this user in the leaderboard and updated tables
            await env.CLOUD_DB.prepare(`DELETE FROM rangle_leaderboard WHERE user_id = ?`).bind(user_id).run();
            await env.CLOUD_DB.prepare(`DELETE FROM rangle_updated WHERE user_id = ?`).bind(user_id).run();
            await env.CLOUD_DB.prepare(`DELETE FROM rangle_guilds WHERE user_id = ?`).bind(user_id).run();
            await env.CLOUD_DB.prepare(`DELETE FROM rangle_user_info WHERE user_id = ?`).bind(user_id).run();
        }
    },
    routes: {
        get: {
            "/guilds/:guild_id/leaderboard/:date": async (request, env) => {
                const {success} = await env.RATE_LIMIT_STORAGE_READ.limit({key: request.auth.sub});
                if (!success) {
                    return new Response("Too many requests", { status: 429 });
                }

                const { guild_id, date } = request.params;

                // first check they still have a valid jwt grant
                const grant = request.headers.get("X-Leaderboard-Grant");
                if (!grant) {
                    return new Response("Missing leaderboard grant", { status: 401 });
                }

                try {
                    const {payload} = await jwtVerify(grant, new TextEncoder().encode(env.JWT_SECRET));
                    if (payload.sub !== request.auth.sub) {
                        return new Response("Grant does not belong to the authenticated user", { status: 401 });
                    }
                } catch (e) {
                    return new Response("Invalid or expired grant", { status: 401 });
                }

                // next check the user belongs to the guild
                const membership = await env.CLOUD_DB.prepare(
                    `SELECT 1 FROM rangle_guilds WHERE guild_id = ? AND user_id = ?`
                ).bind(guild_id, request.auth.sub).first();

                if (!membership) {
                    return new Response("Not a member of this guild", { status: 403 });
                }

                // use a join to collect all users in the guild with scores on that day in order (where least attempts and most bonus correct is best)
                const leaderboard = await env.CLOUD_DB.prepare(
                    `
                    SELECT
                        l.user_id,
                        l.n_attempts,
                        l.hardcore,
                        l.n_correct_bonus,
                        u.username,
                        u.avatar_url
                    FROM rangle_leaderboard l
                             JOIN rangle_guilds g ON l.user_id = g.user_id
                             JOIN rangle_user_info u ON l.user_id = u.user_id
                    WHERE g.guild_id = ? AND l.date = ?
                    ORDER BY l.n_attempts ASC, l.n_correct_bonus DESC
                     `
                ).bind(guild_id, date).all();

                return new Response(JSON.stringify(leaderboard.results), { headers: { "Content-Type": "application/json" } });
            }
        },
        post: {
            "/sync_guilds": async (request, env) => {
                const {success} = await env.RATE_LIMIT_STORAGE_WRITE.limit({key: request.auth.sub});
                if (!success) {
                    return new Response("Too many requests", { status: 429 });
                }

                const { discord_access_token } = await request.json() as { discord_access_token?: string };
                const user_id = request.auth.sub;

                if (!discord_access_token) {
                    return new Response("Missing Discord access token", { status: 400 });
                }

                // use the access token to get the user's guilds
                const guilds_response = await fetch("https://discord.com/api/users/@me/guilds", {
                    headers: {
                        Authorization: `Bearer ${discord_access_token}`
                    }
                });

                if (!guilds_response.ok) {
                    console.error("Failed to fetch user guilds:", await guilds_response.text());
                    return new Response("Failed to fetch user guilds", { status: 500 });
                }

                const guilds = await guilds_response.json() as (MiniGuild & {id: string})[];

                // update the database with the user's guilds. we can just delete all their existing guilds and reinsert
                const statements = [
                    env.CLOUD_DB.prepare(`DELETE FROM rangle_guilds WHERE user_id = ?`).bind(user_id)
                ];

                const mini_guilds: Record<string, MiniGuild> = {};
                for (const guild of guilds) {
                    statements.push(
                        env.CLOUD_DB.prepare(`INSERT INTO rangle_guilds (guild_id, user_id) VALUES (?, ?)`).bind(guild.id, user_id)
                    );

                    mini_guilds[guild.id] = {
                        name: guild.name,
                        icon: guild.icon
                    };
                }

                await env.CLOUD_DB.batch(statements);

                // issue a short-lived jwt for accessing the guild for 10 minutes, to account for invalidation if they leave/get kicked from a guild
                const expires_at = Math.floor(Date.now() / 1000) + 60 * 10; // 10 minutes from now
                const jwt = await new SignJWT({
                    sub: user_id,
                })
                    .setProtectedHeader({ alg: "HS256" })
                    .setExpirationTime(expires_at)
                    .sign(new TextEncoder().encode(env.JWT_SECRET));

                return new Response(JSON.stringify({ token: jwt, expires_at, guilds: mini_guilds }), { headers: { "Content-Type": "application/json" } });
            }
        },
        put: {
            "/checkin": async (request, env) => {
                const {success} = await env.RATE_LIMIT_STORAGE_WRITE.limit({key: request.auth.sub});
                if (!success) {
                    return new Response("Too many requests", { status: 429 });
                }

                // upsert their user details
                await env.CLOUD_DB.prepare(
                    `INSERT INTO rangle_user_info (user_id, username, avatar_url) VALUES (?, ?, ?)
                     ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, avatar_url = excluded.avatar_url`
                )
                    .bind(request.auth.sub, request.auth.username, request.auth.avatar)
                    .run();

                return new Response(null, { status: 204 });
            }
        }
    }
} satisfies App;

// TODO: move the state merging logic to the cloud, and upload day by day instead of syncing whole multiday states every attempt
