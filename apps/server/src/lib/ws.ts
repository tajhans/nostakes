import { nanoid } from "nanoid";
import { WebSocket } from "ws";
import { redis } from "./redis";

interface ChatMessage {
	type: "chat";
	id: string;
	roomId: string;
	userId: string;
	username: string;
	message: string;
	timestamp: number;
}

type WebSocketMessage = ChatMessage;

const rooms = new Map<string, Set<WebSocket>>();

const ROOM_MESSAGES_EXPIRY = 60 * 60 * 24;

async function getRecentMessages(roomId: string): Promise<ChatMessage[]> {
	try {
		const messages = (await redis.lrange(
			`room:${roomId}:messages`,
			0,
			-1,
		)) as unknown as ChatMessage[];

		return messages;
	} catch (error) {
		console.error("Failed to get recent messages:", error);
		return [];
	}
}

async function storeMessage(message: ChatMessage): Promise<void> {
	try {
		const messageString = JSON.stringify(message);

		await redis.lpush(`room:${message.roomId}:messages`, messageString);
		await redis.ltrim(`room:${message.roomId}:messages`, 0, 99);
		await redis.expire(`room:${message.roomId}:messages`, ROOM_MESSAGES_EXPIRY);
	} catch (error) {
		console.error("Failed to store message:", error);
	}
}

export async function handleWebSocket(
	ws: WebSocket,
	roomId: string,
	userId: string,
	username: string,
) {
	if (!rooms.has(roomId)) {
		rooms.set(roomId, new Set());
	}

	const room = rooms.get(roomId);

	if (!room) {
		console.error(
			`Room ${roomId} unexpectedly not found after creation attempt.`,
		);
		throw new Error(`Room ${roomId} unexpectedly not found`);
	}

	room.add(ws);

	const recentMessages = await getRecentMessages(roomId);
	if (recentMessages.length > 0) {
		ws.send(
			JSON.stringify({
				type: "history",
				messages: recentMessages,
			}),
		);
	}

	ws.on("message", async (data) => {
		try {
			const payload = JSON.parse(data.toString());
			if (payload.type === "chat") {
				const message: ChatMessage = {
					...payload,
					id: nanoid(),
					timestamp: Date.now(),
				};

				await storeMessage(message);

				// Replaced forEach with for...of loop
				for (const client of room) {
					if (client.readyState === WebSocket.OPEN) {
						client.send(JSON.stringify(message));
					}
				}
			}
		} catch (error) {
			console.error("Failed to handle WebSocket message:", error);
		}
	});

	ws.on("close", () => {
		room.delete(ws);
		if (room.size === 0) {
			rooms.delete(roomId);
		}
	});
}

export async function cleanupRoomMessages(roomId: string): Promise<void> {
	try {
		await redis.del(`room:${roomId}:messages`);
	} catch (error) {
		console.error("Failed to cleanup room messages:", error);
	}
}
