import { nanoid } from "nanoid";
import { WebSocket } from "ws";
import {
	getAllRoomMembers,
	getRecentMessages,
	redis,
	storeMessage,
	updateRoomMemberActiveStatus,
} from "./redis";
import type { RoomMemberInfo } from "./redis";

interface ChatMessage {
	type: "chat";
	id: string;
	roomId: string;
	userId: string;
	username: string;
	message: string;
	timestamp: number;
}

interface MessageHistory {
	type: "history";
	messages: ChatMessage[];
}

interface RoomStateUpdate {
	type: "room_state";
	members: RoomMemberInfo[];
}

interface RoomClosed {
	type: "room_closed";
}

type ServerWebSocketMessage =
	| ChatMessage
	| MessageHistory
	| RoomStateUpdate
	| RoomClosed;

interface ClientChatMessage {
	type: "chat";
	message: string;
}

type ClientWebSocketMessage = ClientChatMessage;

const rooms = new Map<string, Map<string, WebSocket>>();
const MAX_MESSAGE_LENGTH = 32;

function broadcast(
	roomId: string,
	message: ServerWebSocketMessage,
	senderId?: string,
) {
	const roomConnections = rooms.get(roomId);
	if (!roomConnections) return;

	const messageString = JSON.stringify(message);

	for (const [userId, client] of roomConnections) {
		if (client.readyState === WebSocket.OPEN) {
			client.send(messageString);
		} else {
			console.warn(
				`Removing stale WebSocket connection for user ${userId} in room ${roomId}`,
			);
			roomConnections.delete(userId);
			if (roomConnections.size === 0) {
				rooms.delete(roomId);
			}
			updateRoomMemberActiveStatus(roomId, userId, false).catch(console.error);
			broadcastRoomState(roomId).catch(console.error);
		}
	}
}

export async function broadcastRoomState(roomId: string) {
	try {
		const members = await getAllRoomMembers(roomId);
		const activeMembers = members.filter((m) => m.isActive);
		broadcast(roomId, { type: "room_state", members });
	} catch (error) {
		console.error(`Failed to broadcast room state for room ${roomId}:`, error);
	}
}

export function broadcastRoomClosed(roomId: string) {
	broadcast(roomId, { type: "room_closed" });
	const roomConnections = rooms.get(roomId);
	if (roomConnections) {
		for (const [, ws] of roomConnections) {
			ws.close(1000, "Room closed by owner");
		}
		rooms.delete(roomId);
	}
}

export async function handleWebSocket(
	ws: WebSocket,
	roomId: string,
	userId: string,
	username: string,
) {
	let roomConnections = rooms.get(roomId);
	if (!roomConnections) {
		roomConnections = new Map<string, WebSocket>();
		rooms.set(roomId, roomConnections);
	}

	if (roomConnections.has(userId)) {
		console.warn(
			`User ${userId} already connected to room ${roomId}. Closing previous connection.`,
		);
		roomConnections.get(userId)?.close(1011, "New connection established");
	}

	roomConnections.set(userId, ws);
	console.log(
		`User ${userId} (${username}) connected to room ${roomId}. Total users: ${roomConnections.size}`,
	);

	await updateRoomMemberActiveStatus(roomId, userId, true);

	try {
		const recentMessages = await getRecentMessages(roomId);
		if (recentMessages.length > 0) {
			ws.send(
				JSON.stringify({
					type: "history",
					messages: recentMessages,
				}),
			);
		}
	} catch (error) {
		console.error(
			`Failed to send message history to ${userId} in room ${roomId}:`,
			error,
		);
	}

	try {
		const members = await getAllRoomMembers(roomId);
		ws.send(JSON.stringify({ type: "room_state", members }));
	} catch (error) {
		console.error(
			`Failed to send initial room state to ${userId} in room ${roomId}:`,
			error,
		);
	}

	await broadcastRoomState(roomId);

	ws.on("message", async (data) => {
		try {
			const payload: ClientWebSocketMessage = JSON.parse(data.toString());

			if (payload.type === "chat") {
				let messageContent = payload.message.trim();
				if (messageContent.length > MAX_MESSAGE_LENGTH) {
					messageContent = messageContent.substring(0, MAX_MESSAGE_LENGTH);
				}

				if (!messageContent) {
					return;
				}

				const message: ChatMessage = {
					type: "chat",
					id: nanoid(),
					roomId,
					userId,
					username,
					message: messageContent,
					timestamp: Date.now(),
				};

				await storeMessage(message);
				broadcast(roomId, message);
			}
		} catch (error) {
			console.error(
				`Failed to handle WebSocket message from ${userId} in room ${roomId}:`,
				error,
			);
		}
	});

	ws.on("close", async (code, reason) => {
		console.log(
			`User ${userId} disconnected from room ${roomId}. Code: ${code}, Reason: ${reason?.toString()}`,
		);
		roomConnections.delete(userId);

		await updateRoomMemberActiveStatus(roomId, userId, false);

		await broadcastRoomState(roomId);

		if (roomConnections.size === 0) {
			console.log(
				`Room ${roomId} is now empty. Removing from active rooms map.`,
			);
			rooms.delete(roomId);
		}
	});

	ws.on("error", (error) => {
		console.error(
			`WebSocket error for user ${userId} in room ${roomId}:`,
			error,
		);
		if (roomConnections.has(userId)) {
			roomConnections.delete(userId);
			updateRoomMemberActiveStatus(roomId, userId, false)
				.then(() => broadcastRoomState(roomId))
				.catch(console.error);

			if (roomConnections.size === 0) {
				rooms.delete(roomId);
			}
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
