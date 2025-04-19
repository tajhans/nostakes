import { nanoid } from "nanoid";
import { WebSocket } from "ws";
import type { Card, GameState, PlayerState } from "./poker";
import { performAction } from "./poker";
import {
	getAllRoomMembers,
	getGameState,
	redis,
	setGameState,
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

type ClientGameState = Omit<GameState, "deck">;

interface GameStateUpdate {
	type: "game_state";
	gameState: ClientGameState;
}

type ServerWebSocketMessage =
	| ChatMessage
	| MessageHistory
	| RoomStateUpdate
	| RoomClosed
	| GameStateUpdate;

interface ClientChatMessage {
	type: "chat";
	message: string;
}

interface ClientFoldAction {
	type: "action";
	action: "fold";
}
interface ClientCheckAction {
	type: "action";
	action: "check";
}
interface ClientCallAction {
	type: "action";
	action: "call";
}
interface ClientBetAction {
	type: "action";
	action: "bet";
	amount: number;
}
interface ClientRaiseAction {
	type: "action";
	action: "raise";
	amount: number;
}

type ClientPokerAction =
	| ClientFoldAction
	| ClientCheckAction
	| ClientCallAction
	| ClientBetAction
	| ClientRaiseAction;

type ClientWebSocketMessage = ClientChatMessage | ClientPokerAction;

const rooms = new Map<string, Map<string, WebSocket>>();
const MAX_MESSAGE_LENGTH = 32;

function broadcast(roomId: string, message: ServerWebSocketMessage) {
	const roomConnections = rooms.get(roomId);
	if (!roomConnections) return;

	for (const [userId, client] of roomConnections) {
		if (client.readyState === WebSocket.OPEN) {
			let messageToSend = message;

			if (message.type === "game_state") {
				const gameStateWithoutDeck = message.gameState;

				const maskedPlayerStates: Record<string, PlayerState> = {};
				for (const pId in gameStateWithoutDeck.playerStates) {
					const playerState = gameStateWithoutDeck.playerStates[pId];
					if (pId === userId) {
						maskedPlayerStates[pId] = playerState;
					} else {
						maskedPlayerStates[pId] = { ...playerState, hand: [] };
					}
				}

				const maskedGameStateUpdate: GameStateUpdate = {
					type: "game_state",
					gameState: {
						...gameStateWithoutDeck,
						playerStates: maskedPlayerStates,
					},
				};
				messageToSend = maskedGameStateUpdate;
			}

			client.send(JSON.stringify(messageToSend));
		} else {
			console.warn(
				`Removing stale WebSocket connection for user ${userId} in room ${roomId}`,
			);
			roomConnections.delete(userId);

			Promise.allSettled([
				updateRoomMemberActiveStatus(roomId, userId, false),
				broadcastRoomState(roomId),
				broadcastGameState(roomId),
			]).catch(console.error);

			if (roomConnections.size === 0) {
				rooms.delete(roomId);
			}
		}
	}
}

export async function broadcastRoomState(roomId: string) {
	try {
		const members = await getAllRoomMembers(roomId);
		broadcast(roomId, { type: "room_state", members });
	} catch (error) {
		console.error(`Failed to broadcast room state for room ${roomId}:`, error);
	}
}

export async function broadcastGameState(roomId: string) {
	try {
		const fullGameState = await getGameState(roomId);
		if (fullGameState) {
			const { deck, ...gameStateWithoutDeck } = fullGameState;
			broadcast(roomId, {
				type: "game_state",
				gameState: gameStateWithoutDeck,
			});
		}
	} catch (error) {
		console.error(`Failed to broadcast game state for room ${roomId}:`, error);
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
		const members = await getAllRoomMembers(roomId);
		ws.send(JSON.stringify({ type: "room_state", members }));
	} catch (error) {
		console.error(
			`Failed to send initial room state to ${userId} in room ${roomId}:`,
			error,
		);
	}

	try {
		const gameState = await getGameState(roomId);
		if (gameState) {
			const { deck, ...gameStateWithoutDeck } = gameState;

			const maskedPlayerStates: Record<string, PlayerState> = {};
			for (const pId in gameStateWithoutDeck.playerStates) {
				const playerState = gameStateWithoutDeck.playerStates[pId];
				if (pId === userId) {
					maskedPlayerStates[pId] = playerState;
				} else {
					maskedPlayerStates[pId] = { ...playerState, hand: [] };
				}
			}

			const userSpecificGameStateUpdate: GameStateUpdate = {
				type: "game_state",
				gameState: {
					...gameStateWithoutDeck,
					playerStates: maskedPlayerStates,
				},
			};
			ws.send(JSON.stringify(userSpecificGameStateUpdate));
		}
	} catch (error) {
		console.error(
			`Failed to send initial game state to ${userId} in room ${roomId}:`,
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
			} else if (payload.type === "action") {
				const currentGameState = await getGameState(roomId);
				if (!currentGameState) {
					console.error(
						`Received action for room ${roomId} but no game state found.`,
					);
					return;
				}

				try {
					const updatedGameState = await performAction(
						currentGameState,
						userId,
						payload,
					);

					await setGameState(roomId, updatedGameState);
					await broadcastGameState(roomId);

					if (updatedGameState.phase === "end_hand") {
						console.log(`Hand ended in room ${roomId}.`);
					}
				} catch (error: unknown) {
					let errorMessage =
						"An unknown error occurred while performing the action.";
					if (error instanceof Error) {
						errorMessage = error.message;
					} else if (typeof error === "string") {
						errorMessage = error;
					}
					console.error(
						`Error performing action for user ${userId} in room ${roomId}:`,
						errorMessage,
						error,
					);
					ws.send(JSON.stringify({ type: "error", message: errorMessage }));
				}
			}
		} catch (error: unknown) {
			console.error(
				`Failed to handle WebSocket message from ${userId} in room ${roomId}:`,
				error,
			);
			ws.send(
				JSON.stringify({ type: "error", message: "Invalid message format." }),
			);
		}
	});

	ws.on("close", async (code, reason) => {
		console.log(
			`User ${userId} disconnected from room ${roomId}. Code: ${code}, Reason: ${reason?.toString()}`,
		);
		roomConnections.delete(userId);

		Promise.allSettled([
			updateRoomMemberActiveStatus(roomId, userId, false),
			broadcastRoomState(roomId),
			broadcastGameState(roomId),
		]).catch(console.error);

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
			Promise.allSettled([
				updateRoomMemberActiveStatus(roomId, userId, false),
				broadcastRoomState(roomId),
				broadcastGameState(roomId),
			]).catch(console.error);

			if (roomConnections.size === 0) {
				console.log(
					`Room ${roomId} is now empty due to WebSocket error. Removing from active rooms map.`,
				);
				rooms.delete(roomId);
			}
		}
		if (
			ws.readyState === WebSocket.OPEN ||
			ws.readyState === WebSocket.CONNECTING
		) {
			ws.terminate();
		}
	});
}

export async function cleanupRoomMessages(roomId: string): Promise<void> {
	try {
		const messageKey = `room:${roomId}:messages`;
		console.log(`Cleaning up messages for room ${roomId} (Key: ${messageKey})`);
		const result = await redis.del(messageKey);
		console.log(`Message cleanup result for room ${roomId}: ${result}`);
	} catch (error) {
		console.error(`Failed to cleanup room messages for ${roomId}:`, error);
	}
}
