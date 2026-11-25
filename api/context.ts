import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { User } from "./middleware";

export interface Context {
  user: User | null;
}

export function createContext(user: User | null): Context {
  return { user };
}

export const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export { TRPCError };
