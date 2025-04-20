import { trpcServer } from "@hono/trpc-server";
import type { ServerWebSocket } from "bun";
import "dotenv/config";
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { auth } from "./lib/auth";
import { createContext } from "./lib/context";
import { handleWebSocket } from "./lib/ws";
import { appRouter } from "./routers/index";

const app = new Hono();
const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

app.use(logger());

app.use(
	"/*",
	cors({
		origin: process.env.CORS_ORIGIN || "",
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	}),
);

app.on(["POST", "GET"], "/api/auth/**", (c) => auth.handler(c.req.raw));

app.use(
	"/trpc/*",
	trpcServer({
		router: appRouter,
		createContext: (_opts, context) => {
			return createContext({ context });
		},
	}),
);

app.get("/", (c) => {
	return c.text("OK");
});

app.get(
	"/ws",
	upgradeWebSocket((c) => {
		const roomId = c.req.query("roomId");
		const userId = c.req.query("userId");
		const username = c.req.query("username");

		if (!roomId || !userId || !username) {
			console.error(
				"WebSocket upgrade rejected: Missing roomId, userId, or username in query parameters.",
			);

			return {
				onOpen: (_evt, ws) => {
					console.error("WS connection opened with missing params, closing.");
					ws.close(1008, "Missing required query parameters");
				},
				onError: (err) => {
					console.error("WS upgrade error due to missing params:", err);
				},
			};
		}

		console.log(
			`WebSocket upgrade request for room ${roomId}, user ${userId} (${username})`,
		);

		return handleWebSocket(roomId, userId, username);
	}),
);

export default {
	fetch: app.fetch,
	websocket,
};
