import type { ServerWebSocket } from "bun";
import type { WSContext } from "hono/ws";
import { nanoid } from "nanoid";
import type { GameState, PlayerState } from "./poker";
import { performAction } from "./poker";
import {
	getAllRoomMembers,
	getGameState,
	getRecentMessages,
	redis,
	setGameState,
	setRoomMember,
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

interface ErrorMessage {
	type: "error";
	message: string;
}

type ServerWebSocketMessage =
	| ChatMessage
	| MessageHistory
	| RoomStateUpdate
	| RoomClosed
	| GameStateUpdate
	| ErrorMessage;

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

const rooms = new Map<
	string,
	Map<string, WSContext<ServerWebSocket<undefined>>>
>();
const MAX_MESSAGE_LENGTH = 32;

function broadcast(roomId: string, message: ServerWebSocketMessage) {
	const roomConnections = rooms.get(roomId);
	if (!roomConnections) return;

	const messageString = JSON.stringify(message);

	for (const [userId, client] of roomConnections) {
		if (client.readyState === 1) {
			let messageToSendString = messageString;

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
				messageToSendString = JSON.stringify(maskedGameStateUpdate);
			}

			try {
				client.send(messageToSendString);
			} catch (error) {
				console.error(
					`Failed to send message to user ${userId} in room ${roomId}:`,
					error,
				);
			}
		} else {
			console.warn(
				`Removing non-open WebSocket connection for user ${userId} in room ${roomId}. State: ${client.readyState}`,
			);
			roomConnections.delete(userId);

			Promise.allSettled([
				updateRoomMemberActiveStatus(roomId, userId, false),
				broadcastRoomState(roomId),
				broadcastGameState(roomId),
			]).catch(console.error);

			if (roomConnections.size === 0) {
				console.log(
					`Room ${roomId} is now empty after cleanup. Removing from active rooms map.`,
				);
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
		console.log(`Closing all connections for room ${roomId} due to closure.`);
		for (const [userId, ws] of roomConnections) {
			try {
				if (ws.readyState === 1) {
					ws.close(1000, "Room closed by owner");
				}
			} catch (error) {
				console.error(
					`Error closing WebSocket for user ${userId} in room ${roomId}:`,
					error,
				);
			}
		}
		rooms.delete(roomId);
	}
}

export function handleWebSocket(
	roomId: string,
	userId: string,
	username: string,
) {
	return {
		onOpen: async (
			_event: Event,
			ws: WSContext<ServerWebSocket<undefined>>,
		) => {
			if (!roomId || !userId || !username) {
				console.error(
					"WebSocket opened but missing required parameters. Closing.",
				);
				ws.close(1008, "Missing required parameters");
				return;
			}

			console.log(
				`WebSocket connection opened for user ${userId} (${username}) in room ${roomId}`,
			);

			let roomConnections = rooms.get(roomId);
			if (!roomConnections) {
				roomConnections = new Map<
					string,
					WSContext<ServerWebSocket<undefined>>
				>();
				rooms.set(roomId, roomConnections);
			}

			if (roomConnections.has(userId)) {
				console.warn(
					`User ${userId} already connected to room ${roomId}. Closing previous connection.`,
				);
				const oldWs = roomConnections.get(userId);
				try {
					if (oldWs && oldWs.readyState === 1) {
						oldWs.close(1011, "New connection established");
					}
				} catch (error) {
					console.error(
						`Error closing old WebSocket for user ${userId} in room ${roomId}:`,
						error,
					);
				}
			}

			roomConnections.set(userId, ws);
			console.log(
				`User ${userId} (${username}) connection stored for room ${roomId}. Total users: ${roomConnections.size}`,
			);

			try {
				await updateRoomMemberActiveStatus(roomId, userId, true);

				const members = await getAllRoomMembers(roomId);
				if (ws.readyState === 1) {
					ws.send(JSON.stringify({ type: "room_state", members }));
				}

				const gameState = await getGameState(roomId);
				if (gameState && ws.readyState === 1) {
					const { deck, ...gameStateWithoutDeck } = gameState;
					const maskedPlayerStates: Record<string, PlayerState> = {};
					for (const pId in gameStateWithoutDeck.playerStates) {
						const playerState = gameStateWithoutDeck.playerStates[pId];
						maskedPlayerStates[pId] =
							pId === userId ? playerState : { ...playerState, hand: [] };
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

				const recentMessages = await getRecentMessages(roomId);
				if (ws.readyState === 1) {
					const historyMessage: MessageHistory = {
						type: "history",
						messages: recentMessages,
					};
					ws.send(JSON.stringify(historyMessage));
				}

				await broadcastRoomState(roomId);
			} catch (error) {
				console.error(
					`Error during WebSocket onOpen for user ${userId} in room ${roomId}:`,
					error,
				);
			}
		},

		onMessage: async (
			event: MessageEvent,
			ws: WSContext<ServerWebSocket<undefined>>,
		) => {
			try {
				const payload: ClientWebSocketMessage = JSON.parse(
					event.data.toString(),
				);
				console.log(
					`Received message from ${userId} in room ${roomId}:`,
					payload,
				);

				if (payload.type === "chat") {
					let messageContent = payload.message.trim();
					if (messageContent.length > MAX_MESSAGE_LENGTH) {
						messageContent = messageContent.substring(0, MAX_MESSAGE_LENGTH);
					}
					if (!messageContent) return;

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
							`Received action from ${userId} for room ${roomId} but no game state found.`,
						);
						if (ws.readyState === 1) {
							ws.send(
								JSON.stringify({
									type: "error",
									message: "Game not found or not started.",
								}),
							);
						}
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
							console.log(
								`Hand ended in room ${roomId}. Updating member stacks in Redis.`,
							);
							const finalPlayerStates = updatedGameState.playerStates;
							const currentMembers = await getAllRoomMembers(roomId);

							const updatePromises = currentMembers.map(async (member) => {
								const finalState = finalPlayerStates[member.userId];
								if (finalState) {
									const updatedMemberInfo: RoomMemberInfo = {
										...member,
										currentStack: finalState.stack,
										wantsToPlayNextHand: member.wantsToPlayNextHand ?? false,
									};
									return setRoomMember(roomId, updatedMemberInfo);
								}
								return Promise.resolve();
							});

							await Promise.all(updatePromises);
							console.log(
								`Finished updating member stacks in Redis for room ${roomId}.`,
							);
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

						if (ws.readyState === 1) {
							ws.send(JSON.stringify({ type: "error", message: errorMessage }));
						}
					}
				}
			} catch (error: unknown) {
				console.error(
					`Failed to handle WebSocket message from ${userId} in room ${roomId}:`,
					error,
				);
				if (ws.readyState === 1) {
					ws.send(
						JSON.stringify({
							type: "error",
							message: "Invalid message format or server error.",
						}),
					);
				}
			}
		},

		onClose: async (
			event: CloseEvent,
			_ws: WSContext<ServerWebSocket<undefined>>,
		) => {
			console.log(
				`WebSocket connection closed for user ${userId} in room ${roomId}. Code: ${event.code}, Reason: ${event.reason}`,
			);

			const roomConnections = rooms.get(roomId);
			if (roomConnections) {
				if (roomConnections.get(userId) === _ws) {
					roomConnections.delete(userId);
					console.log(
						`Removed user ${userId} connection from room ${roomId}. Remaining: ${roomConnections.size}`,
					);

					Promise.allSettled([
						updateRoomMemberActiveStatus(roomId, userId, false),
						broadcastRoomState(roomId),
						broadcastGameState(roomId),
					]).catch(console.error);

					if (roomConnections.size === 0) {
						console.log(
							`Room ${roomId} is now empty after onClose. Removing from active rooms map.`,
						);
						rooms.delete(roomId);
					}
				} else {
					console.log(
						`onClose called for user ${userId}, but the stored WebSocket instance did not match. No cleanup performed for this event.`,
					);
				}
			} else {
				console.log(
					`onClose called for user ${userId}, but room ${roomId} was not found in the map.`,
				);
			}
		},

		onError: (evt: Event, ws: WSContext<ServerWebSocket<undefined>>) => {
			console.error(
				`WebSocket error event for user ${userId} in room ${roomId}:`,
				evt,
			);

			const roomConnections = rooms.get(roomId);
			if (roomConnections && roomConnections.get(userId) === ws) {
				roomConnections.delete(userId);
				console.log(
					`Removed user ${userId} connection from room ${roomId} due to error. Remaining: ${roomConnections.size}`,
				);

				Promise.allSettled([
					updateRoomMemberActiveStatus(roomId, userId, false),
					broadcastRoomState(roomId),
					broadcastGameState(roomId),
				]).catch(console.error);

				if (roomConnections.size === 0) {
					console.log(
						`Room ${roomId} is now empty after onError. Removing from active rooms map.`,
					);
					rooms.delete(roomId);
				}
			}

			try {
				if (ws.readyState === 1) {
					ws.close(1011, "WebSocket error occurred");
				}
			} catch (closeError) {
				console.error(
					`Error trying to close WebSocket after error for user ${userId}:`,
					closeError,
				);
			}
		},
	};
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
