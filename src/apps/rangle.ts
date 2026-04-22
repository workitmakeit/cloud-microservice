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
        },
        delete_me: async (user_id, env) => {
            // delete all entries for this user in the leaderboard and updated tables
            await env.CLOUD_DB.prepare(`DELETE FROM rangle_leaderboard WHERE user_id = ?`).bind(user_id).run();
            await env.CLOUD_DB.prepare(`DELETE FROM rangle_updated WHERE user_id = ?`).bind(user_id).run();
            await env.CLOUD_DB.prepare(`DELETE FROM rangle_guilds WHERE user_id = ?`).bind(user_id).run();
        }
    },
    routes: {
        get: {
            "/guilds/:guild_id/leaderboard/:date": async (request, env) => {
                const { guild_id, date } = request.params;

                // first check they still have a valid jwt grant
                const auth_header = request.headers.get("Authorization");
                if (!auth_header || !auth_header.startsWith("Bearer ")) {
                    return new Response("Missing or invalid Authorization header", { status: 401 });
                }

                const token = auth_header.substring(7);
                try {
                    const {payload} = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET));
                    if (payload.sub !== request.auth.sub) {
                        return new Response("Token does not belong to the authenticated user", { status: 401 });
                    }
                } catch (e) {
                    return new Response("Invalid or expired token", { status: 401 });
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
                    `SELECT rangle_leaderboard.user_id, n_attempts, hardcore, n_correct_bonus
                     FROM rangle_leaderboard
                     JOIN rangle_guilds ON rangle_leaderboard.user_id = rangle_guilds.user_id
                     WHERE rangle_guilds.guild_id = ? AND date = ?
                     ORDER BY n_attempts ASC, n_correct_bonus DESC`
                ).bind(guild_id, date).all();

                return new Response(JSON.stringify(leaderboard), { headers: { "Content-Type": "application/json" } });
            }
        },
        post: {
            "/sync_guilds": async (request, env) => {
                // TODO: store user details

                const { code } = await request.json() as { code: string };
                const user_id = request.auth.sub;

                // exchange for a new access token
                const token_response = await fetch("https://discord.com/api/oauth2/token", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: new URLSearchParams({
                        client_id: env.RANGLE_CLIENT_ID,
                        client_secret: env.RANGLE_CLIENT_SECRET,
                        code,
                        grant_type: "authorization_code",
                    })
                });

                if (!token_response.ok) {
                    console.error("Failed to exchange code for token:", await token_response.text());
                    return new Response("Failed to exchange code for token", { status: 500 });
                }

                const { access_token } = await token_response.json() as { access_token: string };

                // use the access token to get the user's guilds
                const guilds_response = await fetch("https://discord.com/api/users/@me/guilds", {
                    headers: {
                        Authorization: `Bearer ${access_token}`
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
        }
    }
} satisfies App;

// TODO: move the state merging logic to the cloud, and upload day by day instead of syncing whole multiday states every attempt
