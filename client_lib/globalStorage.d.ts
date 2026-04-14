export interface IGlobalStorage {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
}

export class GlobalStorage implements IGlobalStorage {
    /**
     * @param app_id - Unique ID for the app
     * @param base_url - The URL of the storage worker (defaults to cloud.ollieg.codes)
     * @param token - Optional Bearer token (falls back to SSO cookie if omitted)
     */
    constructor(app_id: string, base_url?: string, token?: string | null);

    setToken(token: string): void;

    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
}
