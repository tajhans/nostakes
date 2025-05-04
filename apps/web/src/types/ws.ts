import type { Operation } from "fast-json-patch";
import type { GameState } from "./game";
import type { RoomMemberInfo } from "./room";

export interface ChatMessage {
	type: "chat";
	id: string;
	roomId: string;
	userId: string;
	username: string;
	message: string;
	timestamp: number;
}

export interface ClientChatMessage {
	type: "chat";
	message: string;
}

export interface MessageHistory {
	type: "history";
	messages: ChatMessage[];
}

export interface RoomStateUpdate {
	type: "room_state";
	members: RoomMemberInfo[];
}

export interface RoomClosed {
	type: "room_closed";
}

export interface GameStateUpdate {
	type: "game_state";
	gameState: GameState;
}

export interface GameStatePatchMessage {
	type: "game_state_patch";
	patches: Operation[];
}

export type ClientPokerAction =
	| { type: "action"; action: "fold" }
	| { type: "action"; action: "check" }
	| { type: "action"; action: "call" }
	| { type: "action"; action: "bet"; amount: number }
	| { type: "action"; action: "raise"; amount: number };

export interface ErrorMessage {
	type: "error";
	message: string;
}

export interface UserKickedMessage {
	type: "user_kicked";
	reason: string;
}

export type ServerWebSocketMessage =
	| ChatMessage
	| MessageHistory
	| RoomStateUpdate
	| RoomClosed
	| GameStateUpdate
	| GameStatePatchMessage
	| UserKickedMessage
	| ErrorMessage;
