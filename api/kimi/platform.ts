import type { SessionPayload } from "./types";

/** Display-ready user record served to the frontend. */
export interface PlatformUser {
  unionId: string;
  name: string;
  avatar?: string;
}

export const kimiUsers = {
  /** Fetch the platform profile for a verified access token. */
  async me(_accessToken: string): Promise<PlatformUser | null> {
    return null; // populated by the OAuth callback in auth.ts
  },
};

export type { SessionPayload };
