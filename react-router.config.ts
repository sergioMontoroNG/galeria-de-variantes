import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

// `shopify app dev` proxies the embedded app through an ephemeral Cloudflare
// tunnel (a random *.trycloudflare.com subdomain each run). The tunnel
// terminates HTTPS but forwards to the local Vite dev server over plain
// HTTP, so the request React Router sees has an `http://` origin while the
// browser's `Origin` header is `https://...`. React Router's CSRF check for
// action submissions compares those two verbatim and rejects the mismatch
// with a 400, even though the request is legitimate. Trusting the tunnel's
// wildcard domain only in non-production builds works around that without
// weakening the check for the app's real, deployed origin.
export default {
  allowedActionOrigins:
    process.env.NODE_ENV === "production" ? undefined : ["*.trycloudflare.com"],
  presets: [vercelPreset()],
} satisfies Config;
