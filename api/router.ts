import { authRouter } from "./auth-router";
import { argusRouter } from "./argusRouter";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  argus: argusRouter,
});

export type AppRouter = typeof appRouter;
