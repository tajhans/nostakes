import type { ServerWebSocket } from "bun";
import { type Operation, compare } from "fast-json-patch";
import type { WSContext } from "hono/ws";
import { produce } from "immer";
import { nanoid } from "nanoid";
import type {
	ChatMessage,
	ClientPokerAction,
	ClientWebSocketMessage,
	ErrorMessage,
	GameState,
	GameStatePatchMessage,
	GameStateUpdate,
	MessageHistory,
	PlayerState,
	RoomClosed,
	RoomMemberInfo,
	RoomStateUpdate,
	ServerWebSocketMessage,
	UserKickedMessage,
} from "../types";
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

const rooms = new Map<
	string,
	Map<string, WSContext<ServerWebSocket<undefined>>>
>();
const MAX_MESSAGE_LENGTH = 64;

function broadcast(roomId: string, message: ServerWebSocketMessage) {
	const roomConnections = rooms.get(roomId);
	if (!roomConnections || roomConnections.size === 0) return;

	if (message.type === "game_state_patch") {
		console.warn(
			"[Broadcast] Attempted to broadcast raw patches. Use broadcastGameStatePatches instead.",
		);
		return;
	}

	let commonMessageString: string | undefined;
	if (message.type !== "game_state") {
		try {
			commonMessageString = JSON.stringify(message);
		} catch (error) {
			console.error(
				`[Broadcast Error] Failed to stringify common message for room ${roomId}:`,
				error,
				message,
			);
			return;
		}
	}

	for (const [clientUserId, client] of roomConnections) {
		if (client.readyState === 1) {
			let messageToSendString: string;

			if (message.type === "game_state") {
				let clientSpecificMessage: GameStateUpdate;
				try {
					clientSpecificMessage = produce(message, (draft) => {
						if (draft.type === "game_state") {
							for (const pId in draft.gameState.playerStates) {
								if (pId !== clientUserId) {
									draft.gameState.playerStates[pId].hand = [];
								}
							}
						} else {
							console.error(
								"[Broadcast Immer Error] Unexpected message type inside produce:",
								draft.type,
							);

							throw new Error("Unexpected message type in Immer produce");
						}
					});

					messageToSendString = JSON.stringify(clientSpecificMessage);
				} catch (error) {
					console.error(
						`[Broadcast Error] Failed during Immer production or serialization for user ${clientUserId} in room ${roomId}:`,
						error,
						message,
					);
					continue;
				}
			} else {
				if (commonMessageString === undefined) {
					console.error(
						`[Broadcast Error] commonMessageString is undefined for non-game_state message type ${message.type} in room ${roomId}. Skipping send.`,
					);
					continue;
				}
				messageToSendString = commonMessageString;
			}

			try {
				client.send(messageToSendString);
			} catch (error) {
				console.error(
					`[Broadcast Error] Failed to send message to user ${clientUserId} in room ${roomId}:`,
					error,
				);
				// add logic here to remove the client if sending fails repeatedly?
			}
		} else {
			console.warn(
				`[Broadcast Cleanup] Removing non-open WebSocket connection for user ${clientUserId} in room ${roomId}. State: ${client.readyState}`,
			);
			roomConnections.delete(clientUserId);

			Promise.allSettled([
				updateRoomMemberActiveStatus(roomId, clientUserId, false),
			]).catch(console.error);

			if (roomConnections.size === 0) {
				console.log(
					`[Broadcast Cleanup] Room ${roomId} is now empty after cleaning stale connection. Removing from active rooms map.`,
				);
				rooms.delete(roomId);
				break;
			}
		}
	}
}

export async function broadcastRoomState(roomId: string) {
	try {
		const members = await getAllRoomMembers(roomId);
		broadcast(roomId, { type: "room_state", members });
	} catch (error) {
		console.error(
			`[BroadcastRoomState Error] Failed for room ${roomId}:`,
			error,
		);
	}
}

export async function broadcastGameState(
	roomId: string,
	currentGameState?: GameState | null,
) {
	try {
		const gameStateToBroadcast =
			currentGameState === undefined
				? await getGameState(roomId)
				: currentGameState;

		if (gameStateToBroadcast) {
			const { deck, ...gameStateWithoutDeck } = gameStateToBroadcast;
			broadcast(roomId, {
				type: "game_state",
				gameState: gameStateWithoutDeck,
			});
		} else {
			console.log(
				`[BroadcastGameState] No game state found or provided for room ${roomId}, not broadcasting game state.`,
			);
		}
	} catch (error) {
		console.error(
			`[BroadcastGameState Error] Failed for room ${roomId}:`,
			error,
		);
	}
}

export function broadcastGameStatePatches(
	roomId: string,
	patches: Operation[],
) {
	const roomConnections = rooms.get(roomId);
	if (!roomConnections || roomConnections.size === 0 || patches.length === 0) {
		if (patches.length === 0) {
			console.log(`[Broadcast Patches] No patches to send for room ${roomId}.`);
		}
		return;
	}

	console.log(
		`[Broadcast Patches] Broadcasting ${patches.length} patches for room ${roomId}.`,
	);

	for (const [clientUserId, client] of roomConnections) {
		if (client.readyState === 1) {
			const filteredPatches = patches.filter((patch) => {
				const pathSegments = patch.path.split("/");
				if (
					pathSegments.length >= 4 &&
					pathSegments[1] === "playerStates" &&
					pathSegments[3] === "hand"
				) {
					const patchUserId = pathSegments[2];
					return patchUserId === clientUserId;
				}
				return true;
			});

			const finalFilteredPatches = filteredPatches.filter(
				(patch) => !patch.path.startsWith("/deck"),
			);

			if (finalFilteredPatches.length > 0) {
				const patchMessage: GameStatePatchMessage = {
					type: "game_state_patch",
					patches: finalFilteredPatches,
				};
				try {
					client.send(JSON.stringify(patchMessage));
				} catch (error) {
					console.error(
						`[Broadcast Patches Error] Failed to send patches to user ${clientUserId} in room ${roomId}:`,
						error,
					);
				}
			} else {
				console.log(
					`[Broadcast Patches] No relevant patches to send to user ${clientUserId} after filtering.`,
				);
			}
		} else {
			console.warn(
				`[Broadcast Patches Cleanup] Removing non-open WebSocket connection for user ${clientUserId} in room ${roomId}. State: ${client.readyState}`,
			);
			roomConnections.delete(clientUserId);
			Promise.allSettled([
				updateRoomMemberActiveStatus(roomId, clientUserId, false),
			]).catch(console.error);
			if (roomConnections.size === 0) {
				console.log(
					`[Broadcast Patches Cleanup] Room ${roomId} is now empty. Removing from active rooms map.`,
				);
				rooms.delete(roomId);
				break;
			}
		}
	}
}

export function broadcastRoomClosed(roomId: string) {
	broadcast(roomId, { type: "room_closed" });
	const roomConnections = rooms.get(roomId);
	if (roomConnections) {
		console.log(
			`[Room Closure] Closing all connections for room ${roomId} due to closure.`,
		);
		for (const [userId, ws] of roomConnections) {
			try {
				if (ws.readyState === 1) {
					ws.close(1000, "Room closed by owner");
				}
			} catch (error) {
				console.error(
					`[Room Closure Error] Error closing WebSocket for user ${userId} in room ${roomId}:`,
					error,
				);
			}
		}
		rooms.delete(roomId);
	}
}

export function broadcastUserKicked(
	roomId: string,
	userIdToKick: string,
	reason: string,
) {
	const roomConnections = rooms.get(roomId);
	if (!roomConnections) return;

	const client = roomConnections.get(userIdToKick);
	if (client && client.readyState === 1) {
		const kickMessage: UserKickedMessage = { type: "user_kicked", reason };
		try {
			console.log(
				`[Broadcast Kick] Sending kick message to user ${userIdToKick} in room ${roomId}.`,
			);
			client.send(JSON.stringify(kickMessage));
			client.close(1000, reason);
		} catch (error) {
			console.error(
				`[Broadcast Kick Error] Failed to send kick message or close connection for user ${userIdToKick} in room ${roomId}:`,
				error,
			);
			if (client.readyState < WebSocket.CLOSING) {
				client.close(1011, "Error during kick process");
			}
		} finally {
			roomConnections.delete(userIdToKick);
			console.log(
				`[Broadcast Kick] Removed kicked user ${userIdToKick} connection from room ${roomId}. Remaining: ${roomConnections.size}`,
			);
			if (roomConnections.size === 0) {
				console.log(
					`[Broadcast Kick] Room ${roomId} is now empty after kick. Removing from active rooms map.`,
				);
				rooms.delete(roomId);
			}
		}
	} else {
		console.log(
			`[Broadcast Kick] User ${userIdToKick} not found or not connected in room ${roomId}. Cannot send kick message directly.`,
		);
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
					"[WS OnOpen Error] Missing required parameters. Closing connection.",
				);
				ws.close(1008, "Missing required parameters");
				return;
			}

			console.log(
				`[WS OnOpen] Connection opened for user ${userId} (${username}) in room ${roomId}`,
			);

			let roomConnections = rooms.get(roomId);
			if (!roomConnections) {
				roomConnections = new Map<
					string,
					WSContext<ServerWebSocket<undefined>>
				>();
				rooms.set(roomId, roomConnections);
				console.log(
					`[WS OnOpen] Created new connection map for room ${roomId}.`,
				);
			}

			if (roomConnections.has(userId)) {
				console.warn(
					`[WS OnOpen] User ${userId} already connected to room ${roomId}. Closing previous connection.`,
				);
				const oldWs = roomConnections.get(userId);
				try {
					if (oldWs && oldWs.readyState === 1 /* OPEN */) {
						oldWs.close(1011, "New connection established");
					}
				} catch (error) {
					console.error(
						`[WS OnOpen Error] Error closing old WebSocket for user ${userId} in room ${roomId}:`,
						error,
					);
				}
			}

			roomConnections.set(userId, ws);
			console.log(
				`[WS OnOpen] User ${userId} (${username}) connection stored for room ${roomId}. Total users: ${roomConnections.size}`,
			);

			try {
				await updateRoomMemberActiveStatus(roomId, userId, true);

				const members = await getAllRoomMembers(roomId);
				if (ws.readyState === 1) {
					ws.send(JSON.stringify({ type: "room_state", members }));
				}

				const initialGameState = await getGameState(roomId);
				if (initialGameState && ws.readyState === 1) {
					const { deck, ...gameStateWithoutDeck } = initialGameState;
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
				if (ws.readyState === 1 && recentMessages.length > 0) {
					const historyMessage: MessageHistory = {
						type: "history",
						messages: recentMessages,
					};
					ws.send(JSON.stringify(historyMessage));
				}

				await broadcastRoomState(roomId);
			} catch (error) {
				console.error(
					`[WS OnOpen Error] During state initialization for user ${userId} in room ${roomId}:`,
					error,
				);
				if (ws.readyState === 1) {
					ws.send(
						JSON.stringify({
							type: "error",
							message: "Failed to initialize connection state.",
						}),
					);
				}
			}
		},

		onMessage: async (
			event: MessageEvent,
			ws: WSContext<ServerWebSocket<undefined>>,
		) => {
			let payload: ClientWebSocketMessage;
			try {
				payload = JSON.parse(event.data.toString());
				console.debug(
					`[WS OnMessage] Received from ${userId} in room ${roomId}:`,
					payload.type,
				);
			} catch (parseError) {
				console.error(
					`[WS OnMessage Error] Failed to parse message from ${userId} in room ${roomId}:`,
					parseError,
					event.data,
				);
				if (ws.readyState === 1) {
					ws.send(
						JSON.stringify({
							type: "error",
							message: "Invalid message format.",
						}),
					);
				}
				return;
			}

			try {
				const payload: ClientWebSocketMessage = JSON.parse(
					event.data.toString(),
				);
				console.debug(
					`[WS OnMessage] Received from ${userId} in room ${roomId}:`,
					payload.type,
				);

				if (payload.type === "chat") {
					let messageContent = payload.message.trim();
					if (messageContent.length > MAX_MESSAGE_LENGTH) {
						messageContent = messageContent.substring(0, MAX_MESSAGE_LENGTH);
						console.log(
							`[WS OnMessage] Chat message from ${userId} truncated.`,
						);
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
					try {
						const currentGameState = await getGameState(roomId);
						if (!currentGameState) {
							console.error(
								`[WS OnMessage Action Error] Received action from ${userId} for room ${roomId} but no game state found.`,
							);
							throw new Error("Game not found or not started.");
						}

						const playerState = currentGameState.playerStates[userId];
						if (!playerState) {
							console.warn(
								`[WS OnMessage Action] User ${userId} not found in game state for room ${roomId}. Ignoring action.`,
							);
							throw new Error("You are not currently in this game.");
						}

						const userSeat = playerState.seatNumber;
						if (currentGameState.currentPlayerSeat !== userSeat) {
							console.warn(
								`[WS OnMessage Action] Action received from ${userId} (Seat ${userSeat}) but not their turn (Current Seat: ${currentGameState.currentPlayerSeat}). Ignoring.`,
							);
							throw new Error("Not your turn.");
						}
						if (
							playerState.isFolded ||
							playerState.isAllIn ||
							playerState.isSittingOut
						) {
							console.warn(
								`[WS OnMessage Action] Action received from ${userId} (Seat ${userSeat}) but player cannot act (Folded: ${playerState.isFolded}, AllIn: ${playerState.isAllIn}, SittingOut: ${playerState.isSittingOut}). Ignoring.`,
							);
							throw new Error("You cannot perform an action right now.");
						}

						let updatedGameState: GameState;
						try {
							updatedGameState = await performAction(
								currentGameState,
								userId,
								payload,
							);
						} catch (performActionError: unknown) {
							let specificErrorMessage = "An error occurred during the action.";
							if (performActionError instanceof Error) {
								specificErrorMessage = performActionError.message;
							} else if (typeof performActionError === "string") {
								specificErrorMessage = performActionError;
							}
							console.error(
								`[WS OnMessage Action Error - Perform] User ${userId}, Room ${roomId}: ${specificErrorMessage}`,
								performActionError,
							);
							if (ws.readyState === 1) {
								ws.send(
									JSON.stringify({
										type: "error",
										message: specificErrorMessage,
									}),
								);
							}
							return;
						}

						await setGameState(roomId, updatedGameState);

						const patches = compare(currentGameState, updatedGameState);

						broadcastGameStatePatches(roomId, patches);

						if (updatedGameState.phase === "end_hand") {
							try {
								console.log(
									`[WS OnMessage Action] Hand ended in room ${roomId}. Updating member stacks in Redis.`,
								);
								const finalPlayerStates = updatedGameState.playerStates;
								console.log(
									`[WS EndHand] GameState Stacks: ${Object.values(
										finalPlayerStates,
									)
										.map(
											(p) =>
												`${p.seatNumber}:${p.userId.substring(0, 4)}:${p.stack}`,
										)
										.join(", ")}`,
								);

								const currentMembers = await getAllRoomMembers(roomId);
								console.log(
									`[WS EndHand] currentMembers from Redis (before update): ${currentMembers.map((m) => `${m.seatNumber}:${m.userId.substring(0, 4)}:${m.currentStack}`).join(", ")}`,
								);

								const updatePromises = currentMembers.map(async (member) => {
									const finalState = finalPlayerStates[member.userId];
									if (finalState) {
										const updatedMemberInfo: RoomMemberInfo = {
											userId: member.userId,
											username: member.username,
											seatNumber: member.seatNumber,
											isActive: member.isActive,
											currentStack: finalState.stack,
											wantsToPlayNextHand: member.wantsToPlayNextHand ?? false,
										};
										console.log(
											`[WS EndHand] Preparing to save to Redis for ${member.username} (Seat ${member.seatNumber}): Stack=${updatedMemberInfo.currentStack}`,
										);
										await setRoomMember(roomId, updatedMemberInfo);
									} else {
										console.log(
											`[WS EndHand] No finalState found for member ${member.userId}. Skipping Redis update.`,
										);
									}
								});

								await Promise.all(updatePromises);
								console.log(
									`[WS EndHand] Finished Redis updates for room ${roomId}.`,
								);

								const membersAfterUpdate = await getAllRoomMembers(roomId);
								console.log(
									`[WS EndHand] Members AFTER Redis update: ${membersAfterUpdate.map((m) => `${m.seatNumber}:${m.userId.substring(0, 4)}:${m.currentStack}`).join(", ")}`,
								);

								await broadcastRoomState(roomId);
							} catch (endHandError) {
								console.error(
									`[WS OnMessage Action Error - End Hand] User ${userId}, Room ${roomId}: Failed to update stacks/broadcast room state`,
									endHandError,
								);
							}
						}
					} catch (error: unknown) {
						let errorMessage = "An error occurred while performing the action.";
						if (error instanceof Error) {
							errorMessage = error.message;
						} else if (typeof error === "string") {
							errorMessage = error;
						}
						console.error(
							`[WS OnMessage Action Error] User ${userId}, Room ${roomId}: ${errorMessage}`,
							error,
						);

						if (ws.readyState === 1) {
							ws.send(JSON.stringify({ type: "error", message: errorMessage }));
						}
					}
				}
			} catch (error: unknown) {
				console.error(
					`[WS OnMessage Error] Failed to handle message from ${userId} in room ${roomId}:`,
					error,
				);
				if (ws.readyState === 1) {
					ws.send(
						JSON.stringify({
							type: "error",
							message:
								"Invalid message format or server error processing message.",
						}),
					);
				}
			}
		},

		onClose: async (
			event: CloseEvent,
			ws: WSContext<ServerWebSocket<undefined>>,
		) => {
			console.log(
				`[WS OnClose] Connection closed for user ${userId} in room ${roomId}. Code: ${event.code}, Reason: ${event.reason}`,
			);

			const roomConnections = rooms.get(roomId);
			if (roomConnections) {
				if (roomConnections.get(userId) === ws) {
					roomConnections.delete(userId);
					console.log(
						`[WS OnClose] Removed user ${userId} connection from room ${roomId}. Remaining: ${roomConnections.size}`,
					);

					if (event.reason !== "Kicked by room owner.") {
						const results = await Promise.allSettled([
							updateRoomMemberActiveStatus(roomId, userId, false),
							broadcastRoomState(roomId),
						]);

						results.forEach((result, index) => {
							if (result.status === "rejected") {
								console.error(
									`[WS OnClose Cleanup Error] Task ${index} failed for user ${userId}, room ${roomId}:`,
									result.reason,
								);
							}
						});
					}

					if (roomConnections.size === 0) {
						console.log(
							`[WS OnClose] Room ${roomId} is now empty. Removing from active rooms map.`,
						);
						rooms.delete(roomId);
					}
				} else {
					console.log(
						`[WS OnClose] onClose called for user ${userId} in room ${roomId}, but the stored WebSocket instance did not match the closing one (might have been kicked or reconnected). No cleanup performed for this specific event instance.`,
					);
				}
			} else {
				console.log(
					`[WS OnClose] onClose called for user ${userId}, but room ${roomId} was not found in the active rooms map.`,
				);
			}
		},

		onError: async (evt: Event, ws: WSContext<ServerWebSocket<undefined>>) => {
			console.error(
				`[WS OnError] WebSocket error event for user ${userId} in room ${roomId}:`,
				evt,
			);

			const roomConnections = rooms.get(roomId);
			if (roomConnections && roomConnections.get(userId) === ws) {
				roomConnections.delete(userId);
				console.log(
					`[WS OnError] Removed user ${userId} connection from room ${roomId} due to error. Remaining: ${roomConnections.size}`,
				);

				const results = await Promise.allSettled([
					updateRoomMemberActiveStatus(roomId, userId, false),
					broadcastRoomState(roomId),
					broadcastGameState(roomId),
				]);

				results.forEach((result, index) => {
					if (result.status === "rejected") {
						console.error(
							`[WS OnError Cleanup Error] Task ${index} failed for user ${userId}, room ${roomId}:`,
							result.reason,
						);
					}
				});

				if (roomConnections.size === 0) {
					console.log(
						`[WS OnError] Room ${roomId} is now empty after error handling. Removing from active rooms map.`,
					);
					rooms.delete(roomId);
				}
			} else {
				console.warn(
					`[WS OnError] onError received for user ${userId} in room ${roomId}, but the WebSocket instance didn't match the stored one or the room wasn't found.`,
				);
			}

			try {
				if (ws.readyState === 1 || ws.readyState === 0) {
					ws.close(1011, "WebSocket error occurred");
				}
			} catch (closeError) {
				console.error(
					`[WS OnError] Error trying to close WebSocket after error for user ${userId} in room ${roomId}:`,
					closeError,
				);
			}
		},
	};
}

export async function cleanupRoomMessages(roomId: string): Promise<void> {
	try {
		const messageKey = `room:${roomId}:messages`;
		console.log(
			`[Cleanup] Cleaning up messages for room ${roomId} (Key: ${messageKey})`,
		);
		const result = await redis.del(messageKey);
		console.log(
			`[Cleanup] Message cleanup result for room ${roomId}: ${result} keys deleted.`,
		);
	} catch (error) {
		console.error(
			`[Cleanup Error] Failed to cleanup room messages for ${roomId}:`,
			error,
		);
	}
}
