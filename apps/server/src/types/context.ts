import type { Context as HonoContext } from "hono";

export type CreateContextOptions = {
	context: HonoContext;
};

export type Context = Awaited<ReturnType<typeof createContext>>;

// Import this at runtime from the context file
export declare function createContext(
	options: CreateContextOptions,
): Promise<{ session: unknown }>;
