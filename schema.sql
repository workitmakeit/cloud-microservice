DROP TABLE IF EXISTS globalStorage;
CREATE TABLE globalStorage (
    user_id TEXT,
    app_id TEXT,
    key TEXT,
    value TEXT,

    PRIMARY KEY (user_id, app_id, key)
);
