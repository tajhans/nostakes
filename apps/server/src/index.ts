import { trpcServer } from "@hono/trpc-server";
import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { WebSocketServer } from "ws";
import { auth } from "./lib/auth";
import { createContext } from "./lib/context";
import { handleWebSocket } from "./lib/ws";
import { appRouter } from "./routers/index";

const app = new Hono();

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

const wss = new WebSocketServer({ port: 3002 });

wss.on("connection", (ws, req) => {
	const params = new URLSearchParams(req.url?.split("?")[1]);
	const roomId = params.get("roomId");
	const userId = params.get("userId");
	const username = params.get("username");

	if (!roomId || !userId || !username) {
		ws.close();
		return;
	}

	handleWebSocket(ws, roomId, userId, username);
});

export default app;
