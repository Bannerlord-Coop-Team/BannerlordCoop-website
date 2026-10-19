import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig();
// OpenNext lets middleware cookies override the handler's by default. A server action
// that signs out or switches sessions must win over a refresh in src/middleware.ts,
// as it does in Next itself. Pages cannot set cookies and the GET routes that install
// sessions skip the refresh, so GET keeps the middleware's no-store headers.
config.dangerous = {
    ...config.dangerous,
    headersAndCookiesPriority: (event) => event.method === "GET" || event.method === "HEAD" ? "middleware" : "handler",
};

export default config;
