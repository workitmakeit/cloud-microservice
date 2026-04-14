export class GlobalStorage {
    /**
     * @param {string} app_id - Unique ID for the app
     * @param {string} [base_url] - The URL of the storage worker (defaults to cloud.ollieg.codes)
     * @param {string|null} [token] - Optional Bearer token (falls back to SSO cookie if omitted)
     */
    constructor(app_id, base_url = "https://cloud.ollieg.codes", token = null) {
        if (!app_id) {
            throw new Error("GlobalStorage: app_id is required");
        }

        this.app_id = app_id;
        this.base_url = base_url.replace(/\/$/, "");
        this.token = token;
    }

    setToken(token) {
        this.token = token;
    }

    async _request(path, options = {}) {
        const url = `${this.base_url}${path}`;

        const headers = {
            ...options.headers,
            "Accept": "application/json"
        };

        if (this.token) {
            headers["Authorization"] = `Bearer ${this.token}`;
        }

        const response = await fetch(url, {
            ...options,
            headers,
            credentials: "include"
        });

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            const error_text = await response.text().catch(() => "Unknown Error");
            throw new Error(`GlobalStorage: ${response.status} - ${error_text}`);
        }

        return response;
    }

    async getItem(key) {
        const res = await this._request(`/globalStorage/${this.app_id}/${encodeURIComponent(key)}`);
        if (!res) {
            return null;
        }

        return await res.json();
    }

    async setItem(key, value) {
        await this._request(`/globalStorage/${this.app_id}/${encodeURIComponent(key)}`, {
            method: "PUT",
            headers: { "Content-Type": "text/plain" },
            body: value
        });
    }

    async removeItem(key) {
        await this._request(`/globalStorage/${this.app_id}/${encodeURIComponent(key)}`, {
            method: "DELETE"
        });
    }

    async clear() {
        await this._request(`/globalStorage/${this.app_id}`, {
            method: "DELETE"
        });
    }
}
