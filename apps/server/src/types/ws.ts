import type { Operation } from "fast-json-patch";
import type { ClientGameState } from "./game";
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
	gameState: ClientGameState;
}

export interface GameStatePatchMessage {
	type: "game_state_patch";
	patches: Operation[];
}

export interface ErrorMessage {
	type: "error";
	message: string;
}

export interface UserKickedMessage {
	type: "user_kicked";
	reason: string;
}

export interface ClientFoldAction {
	type: "action";
	action: "fold";
}

export interface ClientCheckAction {
	type: "action";
	action: "check";
}

export interface ClientCallAction {
	type: "action";
	action: "call";
}

export interface ClientBetAction {
	type: "action";
	action: "bet";
	amount: number;
}

export interface ClientRaiseAction {
	type: "action";
	action: "raise";
	amount: number;
}

export type ClientPokerAction =
	| ClientFoldAction
	| ClientCheckAction
	| ClientCallAction
	| ClientBetAction
	| ClientRaiseAction;

export type ServerWebSocketMessage =
	| ChatMessage
	| MessageHistory
	| RoomStateUpdate
	| RoomClosed
	| GameStateUpdate
	| GameStatePatchMessage
	| UserKickedMessage
	| ErrorMessage;

export type ClientWebSocketMessage = ClientChatMessage | ClientPokerAction;
