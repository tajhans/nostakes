import { Redis } from "@upstash/redis";
import type { GameState } from "./poker";

export const redis = new Redis({
	url: process.env.UPSTASH_REDIS_REST_URL || "",
	token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
});

interface ChatMessage {
	type: "chat";
	id: string;
	roomId: string;
	userId: string;
	username: string;
	message: string;
	timestamp: number;
}

const ROOM_MESSAGES_EXPIRY = 60 * 60 * 24;

export interface RoomMemberInfo {
	userId: string;
	username: string;
	seatNumber: number;
	currentStack: number;
	isActive: boolean;
	wantsToPlayNextHand?: boolean;
}

const ROOM_GAME_STATE_KEY_PREFIX = "room_game";
const ROOM_MEMBERS_KEY_PREFIX = "room_members";
const ROOM_STATE_EXPIRY = 60 * 60 * 24;

function getRoomMembersKey(roomId: string): string {
	return `${ROOM_MEMBERS_KEY_PREFIX}:${roomId}`;
}

export async function setRoomMember(
	roomId: string,
	memberInfo: RoomMemberInfo,
): Promise<void> {
	try {
		const key = getRoomMembersKey(roomId);
		const memberDataToStore = {
			...memberInfo,
			wantsToPlayNextHand: memberInfo.wantsToPlayNextHand ?? false,
		};
		await redis.hset(key, { [memberInfo.userId]: memberDataToStore });
		await redis.expire(key, ROOM_STATE_EXPIRY);
	} catch (error) {
		console.error(
			`Failed to set room member ${memberInfo.userId} in room ${roomId}:`,
			error,
		);
	}
}

export async function getRoomMember(
	roomId: string,
	userId: string,
): Promise<RoomMemberInfo | null> {
	try {
		const key = getRoomMembersKey(roomId);
		const member = await redis.hget<RoomMemberInfo>(key, userId);
		if (member && member.wantsToPlayNextHand === undefined) {
			member.wantsToPlayNextHand = false;
		}
		return member;
	} catch (error) {
		console.error(
			`Failed to get room member ${userId} from room ${roomId}:`,
			error,
		);
		return null;
	}
}

export async function getAllRoomMembers(
	roomId: string,
): Promise<RoomMemberInfo[]> {
	try {
		const key = getRoomMembersKey(roomId);
		const membersMap = await redis.hgetall<Record<string, RoomMemberInfo>>(key);
		if (!membersMap) return [];
		return Object.values(membersMap).map((member) => ({
			...member,
			wantsToPlayNextHand: member.wantsToPlayNextHand ?? false,
		}));
	} catch (error) {
		console.error(`Failed to get all members from room ${roomId}:`, error);
		return [];
	}
}

export async function removeRoomMember(
	roomId: string,
	userId: string,
): Promise<void> {
	try {
		const key = getRoomMembersKey(roomId);
		await redis.hdel(key, userId);
	} catch (error) {
		console.error(
			`Failed to remove room member ${userId} from room ${roomId}:`,
			error,
		);
	}
}

export async function updateRoomMemberActiveStatus(
	roomId: string,
	userId: string,
	isActive: boolean,
): Promise<void> {
	try {
		const member = await getRoomMember(roomId, userId);
		if (member) {
			member.isActive = isActive;
			if (!isActive) {
				member.wantsToPlayNextHand = false;
			}
			await setRoomMember(roomId, member);
		} else {
			console.warn(
				`Attempted to update active status for non-existent member ${userId} in room ${roomId}`,
			);
		}
	} catch (error) {
		console.error(
			`Failed to update active status for member ${userId} in room ${roomId}:`,
			error,
		);
	}
}

export async function updateWantsToPlayStatus(
	roomId: string,
	userId: string,
	wantsToPlay: boolean,
): Promise<void> {
	try {
		const member = await getRoomMember(roomId, userId);
		if (member) {
			member.wantsToPlayNextHand = wantsToPlay;
			await setRoomMember(roomId, member);
		} else {
			console.warn(
				`Attempted to update play status for non-existent member ${userId} in room ${roomId}`,
			);
		}
	} catch (error) {
		console.error(
			`Failed to update play status for member ${userId} in room ${roomId}:`,
			error,
		);
	}
}

export async function resetAllWantsToPlayStatuses(
	roomId: string,
): Promise<void> {
	try {
		const members = await getAllRoomMembers(roomId);
		const key = getRoomMembersKey(roomId);
		const updates: Record<string, RoomMemberInfo> = {};
		let needsUpdate = false;
		for (const member of members) {
			if (member.wantsToPlayNextHand) {
				updates[member.userId] = { ...member, wantsToPlayNextHand: false };
				needsUpdate = true;
			}
		}
		if (needsUpdate) {
			await redis.hset(key, updates);
			await redis.expire(key, ROOM_STATE_EXPIRY);
		}
	} catch (error) {
		console.error(`Failed to reset play statuses for room ${roomId}:`, error);
	}
}

export async function deleteRoomMembers(roomId: string): Promise<void> {
	try {
		const key = getRoomMembersKey(roomId);
		await redis.del(key);
	} catch (error) {
		console.error(`Failed to delete members for room ${roomId}:`, error);
	}
}

export async function getRecentMessages(
	roomId: string,
): Promise<ChatMessage[]> {
	try {
		const messagesData = await redis.lrange(`room:${roomId}:messages`, 0, -1);

		return messagesData
			.map((msgData) => {
				if (typeof msgData === "object" && msgData !== null) {
					return msgData as ChatMessage;
				}
			})
			.filter((msg): msg is ChatMessage => msg !== null);
	} catch (error) {
		console.error("Failed to get recent messages:", error);
		return [];
	}
}

export async function storeMessage(message: ChatMessage): Promise<void> {
	try {
		const messageString = JSON.stringify(message);
		const key = `room:${message.roomId}:messages`;
		await redis.lpush(key, messageString);
		await redis.ltrim(key, 0, 99);
		await redis.expire(key, ROOM_MESSAGES_EXPIRY);
	} catch (error) {
		console.error("Failed to store message:", error);
	}
}

export async function cleanupRoomMessages(roomId: string): Promise<void> {
	try {
		await redis.del(`room:${roomId}:messages`);
	} catch (error) {
		console.error("Failed to cleanup room messages:", error);
	}
}

function getRoomGameKey(roomId: string): string {
	return `${ROOM_GAME_STATE_KEY_PREFIX}:${roomId}`;
}

export async function getGameState(roomId: string): Promise<GameState | null> {
	try {
		const key = getRoomGameKey(roomId);
		const state = await redis.get<GameState>(key);
		return state;
	} catch (error) {
		console.error(`Failed to get game state for room ${roomId}:`, error);
		return null;
	}
}

export async function setGameState(
	roomId: string,
	gameState: GameState,
): Promise<void> {
	try {
		const key = getRoomGameKey(roomId);
		gameState.lastUpdateTime = Date.now();
		await redis.set(key, gameState, { ex: ROOM_STATE_EXPIRY });
	} catch (error) {
		console.error(`Failed to set game state for room ${roomId}:`, error);
		throw error;
	}
}

export async function deleteGameState(roomId: string): Promise<void> {
	try {
		const key = getRoomGameKey(roomId);
		await redis.del(key);
	} catch (error) {
		console.error(`Failed to delete game state for room ${roomId}:`, error);
	}
}

export async function cleanupAllRoomKeys(roomId: string): Promise<void> {
	try {
		const keys = [
			`${ROOM_GAME_STATE_KEY_PREFIX}:${roomId}`,
			`${ROOM_MEMBERS_KEY_PREFIX}:${roomId}`,
			`room:${roomId}:messages`,
		];

		console.log(`Cleaning up all Redis keys for room ${roomId}:`, keys);

		const results = await Promise.allSettled(keys.map((key) => redis.del(key)));
		results.forEach((result, index) => {
			if (result.status === "rejected") {
				console.error(`Failed to delete key ${keys[index]}:`, result.reason);
			} else {
				console.log(
					`Successfully deleted key ${keys[index]}: ${result.value} keys removed`,
				);
			}
		});
	} catch (error) {
		console.error(`Failed to cleanup Redis keys for room ${roomId}:`, error);
		throw error;
	}
}
