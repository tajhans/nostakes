import { Redis } from "@upstash/redis";

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
}

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
		// Store the object directly; Upstash Redis handles serialization.
		await redis.hset(key, { [memberInfo.userId]: memberInfo });
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
		// Retrieve the object directly; Upstash Redis handles deserialization.
		const member = await redis.hget<RoomMemberInfo>(key, userId);
		return member; // Returns RoomMemberInfo or null if not found/error
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
		// Retrieve all members; Upstash Redis handles deserialization.
		const membersMap = await redis.hgetall<Record<string, RoomMemberInfo>>(key);
		if (!membersMap) return [];
		// Values are already RoomMemberInfo objects.
		return Object.values(membersMap);
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
			// Use setRoomMember which now correctly handles object storage
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

export async function deleteRoomMembers(roomId: string): Promise<void> {
	try {
		const key = getRoomMembersKey(roomId);
		await redis.del(key);
	} catch (error) {
		console.error(`Failed to delete members for room ${roomId}:`, error);
	}
}

// Chat message functions remain unchanged as they handle strings explicitly
export async function getRecentMessages(
	roomId: string,
): Promise<ChatMessage[]> {
	try {
		const messagesJson = await redis.lrange(`room:${roomId}:messages`, 0, -1);

		return messagesJson.map((msgStr) =>
			JSON.parse(msgStr as string),
		) as ChatMessage[];
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
