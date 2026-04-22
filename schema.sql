CREATE TABLE globalStorage (
    user_id TEXT,
    app_id TEXT,
    key TEXT,
    value TEXT,

    PRIMARY KEY (user_id, app_id, key)
);

CREATE TABLE rangle_leaderboard (
    user_id TEXT,
    date TEXT,
    n_attempts INTEGER,
    hardcore BOOLEAN,
    n_correct_bonus INTEGER,

    PRIMARY KEY (user_id, date)
);

CREATE TABLE rangle_updated (
    user_id TEXT,
    updated TEXT,

    PRIMARY KEY (user_id)
);

CREATE TABLE rangle_guilds (
    guild_id TEXT,
    user_id TEXT,
    verified BOOLEAN NOT NULL,

    PRIMARY KEY (guild_id, user_id)
);
