// OAuth endpoints may be injected by the platform at build time. When absent,
// the KIMI_AUTH_URL / KIMI_OPEN_URL env vars are the source of truth.
export const oauthEndpoints: {
  KIMI_AUTH_URL?: string;
  KIMI_OPEN_URL?: string;
} = {};
