import { z } from "zod";
import { authedMutation, createRouter } from "./middleware";

/**
 * Auth router — exposes session info to the frontend.
 * The OAuth flow itself lives in api/kimi/auth.ts (registered in boot.ts).
 */
export const authRouter = createRouter({
  me: authedMutation.input(z.void()).mutation(async ({ ctx }) => {
    return ctx.user;
  }),
});
