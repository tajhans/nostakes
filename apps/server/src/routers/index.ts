import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getPlaiceholder } from "plaiceholder";
import sharp from "sharp";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { friendship } from "../db/schema/friendships";
import { room, roomMember } from "../db/schema/rooms";
import { startNewHand } from "../lib/poker";
import {
	cleanupAllRoomKeys,
	cleanupRoomMessages,
	deleteGameState,
	deleteRoomMembers,
	getAllRoomMembers,
	getGameState,
	getRoomMember,
	resetAllWantsToPlayStatuses,
	setGameState,
	setRoomMember,
	transferChips,
	updateRoomMemberActiveStatus,
	updateWantsToPlayStatus,
} from "../lib/redis";
import { s3Client } from "../lib/s3";
import { protectedProcedure, publicProcedure, router } from "../lib/trpc";
import {
	broadcastGameState,
	broadcastRoomClosed,
	broadcastRoomState,
	broadcastUserKicked,
} from "../lib/ws";
import type { RoomMemberInfo } from "../types";

const createRoomSchema = z.object({
	players: z.number().min(2, "Minimum 2 players").max(8, "Maximum 8 players"),
	startingStack: z.number().positive("Starting stack must be positive"),
	smallBlind: z.number().positive("Small blind must be positive"),
	bigBlind: z.number().positive("Big blind must be positive"),
	ante: z.number().min(0, "Ante cannot be negative").default(5),
	filterProfanity: z.boolean().default(false),
	public: z.boolean().default(false),
});

const joinRoomSchema = z.object({
	joinCode: z.string().min(1, "Join code is required"),
});

const closeRoomSchema = z.object({
	roomId: z.string().min(1, "Room ID is required"),
});

const leaveRoomSchema = z.object({
	roomId: z.string().min(1, "Room ID is required"),
});

const startGameSchema = z.object({
	roomId: z.string().min(1, "Room ID is required"),
});

const togglePlayStatusSchema = z.object({
	roomId: z.string().min(1, "Room ID is required"),
	wantsToPlay: z.boolean(),
});

const kickUserSchema = z.object({
	roomId: z.string().min(1, "Room ID is required"),
	userIdToKick: z.string().min(1, "User ID to kick is required"),
});

const transferChipsSchema = z.object({
	roomId: z.string().min(1, "Room ID is required"),
	recipientUserId: z.string().min(1, "Recipient User ID is required"),
	amount: z.number().int().positive("Amount must be a positive integer"),
});

const updateMaxPlayersSchema = z.object({
	roomId: z.string().min(1, "Room ID is required"),
	newMaxPlayers: z
		.number()
		.int()
		.min(2, "Minimum players must be 2")
		.max(8, "Maximum players cannot exceed 8"),
});

const updateRoomFilterSchema = z.object({
	roomId: z.string().min(1, "Room ID is required"),
	filterProfanity: z.boolean(),
});

const sendFriendRequestSchema = z.object({
	friendId: z.string().min(1, "Friend ID is required"),
});

const acceptFriendRequestSchema = z.object({
	friendshipUserId: z.string().min(1, "Friendship user ID is required"),
});

const declineFriendRequestSchema = z.object({
	friendshipUserId: z.string().min(1, "Friendship user ID is required"),
});

const removeFriendSchema = z.object({
	friendId: z.string().min(1, "Friend ID is required"),
});

const addFriendByCodeSchema = z.object({
	friendCode: z.string().min(1, "Friend code is required"),
});

async function getUserActiveRoom(userId: string) {
	const [activeRoom] = await db
		.select({
			roomId: roomMember.roomId,
		})
		.from(roomMember)
		.where(and(eq(roomMember.userId, userId), eq(roomMember.isActive, true)))
		.limit(1);

	return activeRoom;
}

function extractKeyFromUrl(imageUrl: string | null): string | null {
	if (!imageUrl) return null;
	try {
		const url = new URL(imageUrl);
		const pathParts = url.pathname.split("/");
		if (pathParts.length > 2) {
			return pathParts.slice(2).join("/");
		}
	} catch (e) {
		console.error("Error parsing image URL:", e);
	}
	return null;
}

async function isHandInProgress(roomId: string): Promise<boolean> {
	const gameState = await getGameState(roomId);
	return (
		!!gameState &&
		gameState.phase !== "waiting" &&
		gameState.phase !== "end_hand"
	);
}

export const appRouter = router({
	healthCheck: publicProcedure.query(() => {
		return "OK";
	}),

	privateData: protectedProcedure.query(({ ctx }) => {
		return {
			message: "This is private",
			user: ctx.session.user,
		};
	}),

	createRoom: protectedProcedure
		.input(createRoomSchema)
		.mutation(async ({ input, ctx }) => {
			const activeRoom = await getUserActiveRoom(ctx.session.user.id);
			if (activeRoom) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"You are already in an active room. Please leave your current room first.",
				});
			}

			if (!ctx.session.user.emailVerified) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Please verify your email address before creating a room.",
				});
			}

			if (input.bigBlind <= input.smallBlind) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Big blind must be greater than small blind.",
				});
			}
			if (input.bigBlind > input.startingStack) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Big blind cannot be greater than the starting stack.",
				});
			}
			if (input.ante > input.startingStack) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Ante cannot be greater than the starting stack.",
				});
			}

			const [newRoom] = await db
				.insert(room)
				.values({
					maxPlayers: input.players,
					startingStack: input.startingStack,
					smallBlind: input.smallBlind,
					bigBlind: input.bigBlind,
					ante: input.ante,
					ownerId: ctx.session.user.id,
					filterProfanity: input.filterProfanity,
					public: input.public,
				})
				.returning();

			const [newMember] = await db
				.insert(roomMember)
				.values({
					roomId: newRoom.id,
					userId: ctx.session.user.id,
					currentStack: input.startingStack,
					seatNumber: 1,
					isActive: true,
				})
				.returning();

			const ownerInfo: RoomMemberInfo = {
				userId: ctx.session.user.id,
				username: ctx.session.user.username || "Unknown",
				seatNumber: newMember.seatNumber,
				currentStack: newMember.currentStack,
				isActive: newMember.isActive,
				wantsToPlayNextHand: false,
			};
			await setRoomMember(newRoom.id, ownerInfo);

			return newRoom;
		}),

	closeRoom: protectedProcedure
		.input(closeRoomSchema)
		.mutation(async ({ input, ctx }) => {
			const [targetRoom] = await db
				.select({ ownerId: room.ownerId })
				.from(room)
				.where(eq(room.id, input.roomId))
				.limit(1);

			if (!targetRoom) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Room not found",
				});
			}

			if (targetRoom.ownerId !== ctx.session.user.id) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the room owner can close the room",
				});
			}

			if (await isHandInProgress(input.roomId)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Cannot close the room while a hand is in progress.",
				});
			}

			broadcastRoomClosed(input.roomId);

			await Promise.all([
				cleanupAllRoomKeys(input.roomId),
				cleanupRoomMessages(input.roomId),
				deleteRoomMembers(input.roomId),
				deleteGameState(input.roomId),
				db.delete(roomMember).where(eq(roomMember.roomId, input.roomId)),
				db.delete(room).where(eq(room.id, input.roomId)),
			]);

			return { success: true };
		}),

	joinRoom: protectedProcedure
		.input(joinRoomSchema)
		.mutation(async ({ input, ctx }) => {
			const activeRoom = await getUserActiveRoom(ctx.session.user.id);
			if (activeRoom) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"You are already in an active room. Please leave your current room first.",
				});
			}

			if (!ctx.session.user.emailVerified) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Please verify your email address before joining a room.",
				});
			}

			const [targetRoom] = await db
				.select()
				.from(room)
				.where(eq(room.joinCode, input.joinCode))
				.limit(1);

			if (!targetRoom) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Room not found",
				});
			}

			if (!targetRoom.isActive) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Room is closed",
				});
			}

			const userId = ctx.session.user.id;
			const username = ctx.session.user.username || "Unknown";

			const [existingMember] = await db
				.select()
				.from(roomMember)
				.where(
					and(
						eq(roomMember.roomId, targetRoom.id),
						eq(roomMember.userId, userId),
					),
				)
				.limit(1);

			let memberInfo: RoomMemberInfo;
			let currentStack = targetRoom.startingStack;

			if (existingMember) {
				currentStack = existingMember.currentStack;
				await db
					.update(roomMember)
					.set({ isActive: true })
					.where(eq(roomMember.id, existingMember.id));

				const redisMember = await getRoomMember(targetRoom.id, userId);

				memberInfo = {
					userId: existingMember.userId,
					username: username,
					seatNumber: existingMember.seatNumber,
					currentStack: currentStack,
					isActive: true,
					wantsToPlayNextHand: redisMember?.wantsToPlayNextHand ?? false,
				};
			} else {
				const currentMembers = await getAllRoomMembers(targetRoom.id);
				const activeMemberCount = currentMembers.filter(
					(m) => m.isActive,
				).length;

				if (activeMemberCount >= targetRoom.maxPlayers) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Room is full",
					});
				}

				const occupiedSeats = new Set(currentMembers.map((m) => m.seatNumber));
				let nextSeat = 1;
				while (
					occupiedSeats.has(nextSeat) &&
					nextSeat <= targetRoom.maxPlayers
				) {
					nextSeat++;
				}

				if (nextSeat > targetRoom.maxPlayers) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Could not assign seat, room might be unexpectedly full.",
					});
				}

				const [newMember] = await db
					.insert(roomMember)
					.values({
						roomId: targetRoom.id,
						userId: userId,
						currentStack: currentStack,
						seatNumber: nextSeat,
						isActive: true,
					})
					.returning();

				memberInfo = {
					userId: newMember.userId,
					username: username,
					seatNumber: newMember.seatNumber,
					currentStack: newMember.currentStack,
					isActive: newMember.isActive,
					wantsToPlayNextHand: false,
				};
			}

			await Promise.all([
				setRoomMember(targetRoom.id, memberInfo),
				broadcastRoomState(targetRoom.id),
				broadcastGameState(targetRoom.id),
			]);

			return targetRoom;
		}),

	leaveRoom: protectedProcedure
		.input(leaveRoomSchema)
		.mutation(async ({ input, ctx }) => {
			const userId = ctx.session.user.id;
			const roomId = input.roomId;

			if (await isHandInProgress(roomId)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Cannot leave the room while a hand is in progress.",
				});
			}

			const [updatedMember] = await db
				.update(roomMember)
				.set({ isActive: false })
				.where(
					and(eq(roomMember.roomId, roomId), eq(roomMember.userId, userId)),
				)
				.returning({ id: roomMember.id, seatNumber: roomMember.seatNumber });

			if (!updatedMember) {
				console.warn(
					`User ${userId} tried to leave room ${roomId} but was not found or already inactive.`,
				);
			}

			await updateRoomMemberActiveStatus(roomId, userId, false);

			await Promise.all([broadcastRoomState(roomId)]);

			return { success: true };
		}),

	getRooms: protectedProcedure.query(async ({ ctx }) => {
		const userRoomsData = await db
			.select({
				id: room.id,
				joinCode: room.joinCode,
				maxPlayers: room.maxPlayers,
				startingStack: room.startingStack,
				smallBlind: room.smallBlind,
				bigBlind: room.bigBlind,
				ante: room.ante,
				isActive: room.isActive,
				createdAt: room.createdAt,
				ownerId: room.ownerId,
				filterProfanity: room.filterProfanity,
				public: room.public,
			})
			.from(room)
			.leftJoin(roomMember, eq(roomMember.roomId, room.id))
			.where(
				sql`${room.ownerId} = ${ctx.session.user.id} OR (${roomMember.userId} = ${ctx.session.user.id} AND ${roomMember.isActive} = true)`,
			)
			.groupBy(room.id)
			.orderBy(desc(room.createdAt));

		const roomIds = userRoomsData.map((r) => r.id);
		if (roomIds.length === 0) {
			return [];
		}

		const membersByRoom: Record<string, RoomMemberInfo[]> = {};
		await Promise.all(
			roomIds.map(async (roomId) => {
				membersByRoom[roomId] = await getAllRoomMembers(roomId);
			}),
		);

		return userRoomsData.map((r) => {
			const members = membersByRoom[r.id] || [];
			return {
				...r,
				members: members.map((m) => ({
					...m,
					wantsToPlayNextHand: m.wantsToPlayNextHand ?? false,
				})),
			};
		});
	}),

	getDiscoverableRooms: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.session.user.id;

		const friendshipsQuery = await db
			.select({
				friendId: friendship.friendId,
				userId: friendship.userId,
			})
			.from(friendship)
			.where(
				and(
					eq(friendship.status, "accepted"),
					or(eq(friendship.userId, userId), eq(friendship.friendId, userId)),
				),
			);

		const friendIds = friendshipsQuery.map((f) =>
			f.userId === userId ? f.friendId : f.userId,
		);

		const discoverableRoomsData = await db
			.select({
				id: room.id,
				joinCode: room.joinCode,
				maxPlayers: room.maxPlayers,
				startingStack: room.startingStack,
				smallBlind: room.smallBlind,
				bigBlind: room.bigBlind,
				ante: room.ante,
				isActive: room.isActive,
				createdAt: room.createdAt,
				ownerId: room.ownerId,
				filterProfanity: room.filterProfanity,
				public: room.public,
			})
			.from(room)
			.where(
				and(
					eq(room.isActive, true),
					or(
						eq(room.public, true),
						friendIds.length > 0 ? inArray(room.ownerId, friendIds) : undefined,
					),
				),
			)
			.orderBy(desc(room.createdAt))
			.limit(100);

		const roomIds = discoverableRoomsData.map((r) => r.id);
		if (roomIds.length === 0) {
			return [];
		}

		const membersByRoom: Record<string, RoomMemberInfo[]> = {};
		await Promise.all(
			roomIds.map(async (roomId) => {
				membersByRoom[roomId] = await getAllRoomMembers(roomId);
			}),
		);

		return discoverableRoomsData.map((r) => {
			const members = membersByRoom[r.id] || [];
			return {
				...r,
				members: members.map((m) => ({
					...m,
					wantsToPlayNextHand: m.wantsToPlayNextHand ?? false,
				})),
			};
		});
	}),

	updateProfile: protectedProcedure
		.input(
			z.object({
				image: z.union([z.string(), z.null()]),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const userId = ctx.session.user.id;
			const username = ctx.session.user.username;

			if (!username) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Username is required to set a profile picture. Please ensure your profile has a username.",
				});
			}

			const userProfile = await db
				.select({ image: user.image, imageBase64: user.imageBase64 })
				.from(user)
				.where(eq(user.id, userId))
				.limit(1)
				.then((rows) => rows[0]);

			const oldImageUrl = userProfile?.image ?? null;
			const oldImageBase64 = userProfile?.imageBase64 ?? null;
			const oldKey = extractKeyFromUrl(oldImageUrl);

			let newImageUrl: string | null = null;
			let newImageBase64: string | null = null;
			let newKey: string | null = null;

			if (input.image) {
				try {
					const buffer = Buffer.from(
						input.image.replace(/^data:image\/\w+;base64,/, ""),
						"base64",
					);

					const webpBuffer = await sharp(buffer).webp().toBuffer();
					const { base64: plaiceholderBase64 } =
						await getPlaiceholder(webpBuffer);
					newImageBase64 = plaiceholderBase64;

					newKey = `${username}.webp`;

					await s3Client.send(
						new PutObjectCommand({
							Bucket: "nostakes",
							Key: newKey,
							Body: webpBuffer,
							ContentType: "image/webp",
						}),
					);

					newImageUrl = `https://image.nostakes.poker/nostakes/${newKey}`;
					console.log(`Uploaded new image: ${newImageUrl}`);
					console.log(`Generated placeholder for ${newKey}`);
				} catch (error) {
					console.error(
						"Failed to process, upload, or generate placeholder:",
						error,
					);

					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Failed to update profile picture.",
						cause: error,
					});
				}
			} else {
				newImageUrl = null;
				newImageBase64 = null;
				newKey = null;
				console.log(`User ${username} is removing their profile picture.`);
			}

			if (oldKey && oldKey !== newKey) {
				try {
					console.log(`Attempting to delete old image with key: ${oldKey}`);
					await s3Client.send(
						new DeleteObjectCommand({
							Bucket: "nostakes",
							Key: oldKey,
						}),
					);
					console.log(`Successfully deleted old image: ${oldKey}`);
				} catch (error) {
					console.error(`Failed to delete old image ${oldKey}:`, error);
				}
			} else if (oldKey && oldKey === newKey) {
				console.log(
					`Old key ${oldKey} is the same as the new key. Skipping deletion.`,
				);
			} else if (oldKey && !input.image) {
				try {
					console.log(
						`Attempting to delete image due to removal request: ${oldKey}`,
					);
					await s3Client.send(
						new DeleteObjectCommand({
							Bucket: "nostakes",
							Key: oldKey,
						}),
					);
					console.log(`Successfully deleted image on removal: ${oldKey}`);
				} catch (error) {
					console.error(
						`Failed to delete image ${oldKey} during removal:`,
						error,
					);
				}
			}

			if (oldImageUrl !== newImageUrl || oldImageBase64 !== newImageBase64) {
				await db
					.update(user)
					.set({
						image: newImageUrl,
						imageBase64: newImageBase64,
						updatedAt: new Date(),
					})
					.where(eq(user.id, userId));
				console.log(
					`Updated database for user ${userId} with image URL: ${newImageUrl} and placeholder.`,
				);
			} else {
				console.log(
					`Image URL and placeholder for user ${userId} haven't changed. Skipping database update.`,
				);
			}

			return { imageUrl: newImageUrl };
		}),

	startGame: protectedProcedure
		.input(startGameSchema)
		.mutation(async ({ input, ctx }) => {
			const roomId = input.roomId;

			const [targetRoom] = await db
				.select({
					ownerId: room.ownerId,
					smallBlind: room.smallBlind,
					bigBlind: room.bigBlind,
					ante: room.ante,
					isActive: room.isActive,
					startingStack: room.startingStack,
				})
				.from(room)
				.where(eq(room.id, roomId))
				.limit(1);

			if (!targetRoom) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Room not found." });
			}
			if (!targetRoom.isActive) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Cannot start game in a closed room.",
				});
			}

			if (targetRoom.ownerId !== ctx.session.user.id) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the room owner can start the game.",
				});
			}

			const currentMembers = await getAllRoomMembers(roomId);
			const activeMembers = currentMembers.filter((m) => m.isActive);

			if (activeMembers.length < 2) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Need at least 2 active players to start.",
				});
			}

			const previousGameState = await getGameState(roomId);

			if (
				previousGameState &&
				previousGameState.phase !== "waiting" &&
				previousGameState.phase !== "end_hand"
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Game already in progress.",
				});
			}

			try {
				const participatingMembers = activeMembers.filter(
					(m) => m.wantsToPlayNextHand === true,
				);

				if (participatingMembers.length < 2) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `Need at least 2 players ready for the next hand. Found ${participatingMembers.length}.`,
					});
				}

				const newGameState = await startNewHand(
					roomId,
					{
						smallBlind: targetRoom.smallBlind,
						bigBlind: targetRoom.bigBlind,
						ante: targetRoom.ante,
					},
					activeMembers,
					previousGameState,
				);

				await setGameState(roomId, newGameState);
				await resetAllWantsToPlayStatuses(roomId);
				await Promise.all([
					broadcastGameState(roomId),
					broadcastRoomState(roomId),
				]);

				return { success: true, message: "Game started." };
			} catch (error: unknown) {
				let errorMessage = "Failed to start game.";
				if (error instanceof Error) {
					errorMessage = `Failed to start game: ${error.message}`;
				} else if (typeof error === "string") {
					errorMessage = `Failed to start game: ${error}`;
				}
				console.error("Error starting game:", error);

				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: errorMessage,
				});
			}
		}),

	togglePlayStatus: protectedProcedure
		.input(togglePlayStatusSchema)
		.mutation(async ({ input, ctx }) => {
			const { roomId, wantsToPlay } = input;
			const userId = ctx.session.user.id;

			const gameState = await getGameState(roomId);
			if (
				gameState &&
				gameState.phase !== "waiting" &&
				gameState.phase !== "end_hand"
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Cannot change play status while hand is in progress.",
				});
			}

			const userMember = await getRoomMember(roomId, userId);
			if (!userMember || !userMember.isActive) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "User not found in room or is inactive.",
				});
			}

			if (wantsToPlay) {
				const [targetRoomData] = await db
					.select({ ante: room.ante })
					.from(room)
					.where(eq(room.id, roomId))
					.limit(1);

				if (!targetRoomData) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Room details not found.",
					});
				}

				if (
					targetRoomData.ante > 0 &&
					userMember.currentStack < targetRoomData.ante
				) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `Insufficient chips (${userMember.currentStack}) to post ante of ${targetRoomData.ante}. You need at least ${targetRoomData.ante}.`,
					});
				}
			}

			await updateWantsToPlayStatus(roomId, userId, wantsToPlay);
			await broadcastRoomState(roomId);

			return { success: true };
		}),

	getActiveRoom: protectedProcedure.query(async ({ ctx }) => {
		const room = await getUserActiveRoom(ctx.session.user.id);
		return room ?? null;
	}),

	kickUser: protectedProcedure
		.input(kickUserSchema)
		.mutation(async ({ input, ctx }) => {
			const { roomId, userIdToKick } = input;
			const adminUserId = ctx.session.user.id;

			const [targetRoom] = await db
				.select({ ownerId: room.ownerId, isActive: room.isActive })
				.from(room)
				.where(eq(room.id, roomId))
				.limit(1);

			if (!targetRoom) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Room not found." });
			}

			if (!targetRoom.isActive) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Cannot kick users from a closed room.",
				});
			}

			if (targetRoom.ownerId !== adminUserId) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the room owner can kick users.",
				});
			}

			if (userIdToKick === adminUserId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You cannot kick yourself.",
				});
			}

			if (await isHandInProgress(roomId)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Cannot kick users while a hand is in progress.",
				});
			}

			const [memberToKick] = await db
				.select({ id: roomMember.id, isActive: roomMember.isActive })
				.from(roomMember)
				.where(
					and(
						eq(roomMember.roomId, roomId),
						eq(roomMember.userId, userIdToKick),
					),
				)
				.limit(1);

			if (!memberToKick) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "User not found in this room.",
				});
			}
			if (memberToKick.isActive) {
				await db
					.update(roomMember)
					.set({ isActive: false })
					.where(eq(roomMember.id, memberToKick.id));
			}

			await updateRoomMemberActiveStatus(roomId, userIdToKick, false);

			broadcastUserKicked(roomId, userIdToKick, "Kicked by room owner.");

			await broadcastRoomState(roomId);

			return { success: true, message: "User kicked successfully." };
		}),

	checkCanDeleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
		const activeRoom = await getUserActiveRoom(ctx.session.user.id);
		if (activeRoom) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message:
					"You cannot delete your account while active in a room. Please leave the room first.",
			});
		}
		return { canDelete: true };
	}),

	transferChips: protectedProcedure
		.input(transferChipsSchema)
		.mutation(async ({ input, ctx }) => {
			const { roomId, recipientUserId, amount } = input;
			const senderUserId = ctx.session.user.id;

			if (senderUserId === recipientUserId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You cannot transfer chips to yourself.",
				});
			}

			if (await isHandInProgress(roomId)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Cannot transfer chips while a hand is in progress.",
				});
			}

			const senderMemberInfo = await getRoomMember(roomId, senderUserId);

			if (!senderMemberInfo) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Sender not found in the room.",
				});
			}

			if (!senderMemberInfo.isActive) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You must be active in the room to transfer chips.",
				});
			}

			if (senderMemberInfo.currentStack < amount) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Insufficient chips. You only have ${senderMemberInfo.currentStack}.`,
				});
			}

			const result = await transferChips(
				roomId,
				senderUserId,
				recipientUserId,
				amount,
			);

			if (!result.success) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: result.message,
				});
			}

			await broadcastRoomState(roomId);

			return { success: true, message: result.message };
		}),

	updateMaxPlayers: protectedProcedure
		.input(updateMaxPlayersSchema)
		.mutation(async ({ input, ctx }) => {
			const { roomId, newMaxPlayers } = input;
			const userId = ctx.session.user.id;

			const [targetRoom] = await db
				.select({
					ownerId: room.ownerId,
					currentMaxPlayers: room.maxPlayers,
					isActive: room.isActive,
				})
				.from(room)
				.where(eq(room.id, roomId))
				.limit(1);

			if (!targetRoom) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Room not found." });
			}

			if (!targetRoom.isActive) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Cannot modify a closed room.",
				});
			}

			if (targetRoom.ownerId !== userId) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the room owner can change the maximum players.",
				});
			}

			if (newMaxPlayers <= targetRoom.currentMaxPlayers) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `New maximum players (${newMaxPlayers}) must be greater than the current maximum (${targetRoom.currentMaxPlayers}).`,
				});
			}

			const currentMembers = await getAllRoomMembers(roomId);
			const activeMemberCount = currentMembers.filter((m) => m.isActive).length;

			if (newMaxPlayers < activeMemberCount) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `New maximum players (${newMaxPlayers}) cannot be less than the current number of active players (${activeMemberCount}).`,
				});
			}

			const [updatedRoom] = await db
				.update(room)
				.set({ maxPlayers: newMaxPlayers, updatedAt: new Date() })
				.where(eq(room.id, roomId))
				.returning({ id: room.id, maxPlayers: room.maxPlayers });

			if (!updatedRoom) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to update room settings.",
				});
			}

			await broadcastRoomState(roomId);

			return {
				success: true,
				message: `Maximum players updated to ${updatedRoom.maxPlayers}.`,
				newMaxPlayers: updatedRoom.maxPlayers,
			};
		}),

	updateRoomFilter: protectedProcedure
		.input(updateRoomFilterSchema)
		.mutation(async ({ input, ctx }) => {
			const { roomId, filterProfanity } = input;
			const userId = ctx.session.user.id;

			const [targetRoom] = await db
				.select({ ownerId: room.ownerId, isActive: room.isActive })
				.from(room)
				.where(eq(room.id, roomId))
				.limit(1);

			if (!targetRoom) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Room not found." });
			}

			if (!targetRoom.isActive) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Cannot modify a closed room.",
				});
			}

			if (targetRoom.ownerId !== userId) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the room owner can change the profanity filter.",
				});
			}

			const [updatedRoom] = await db
				.update(room)
				.set({ filterProfanity: filterProfanity, updatedAt: new Date() })
				.where(eq(room.id, roomId))
				.returning({ id: room.id, filterProfanity: room.filterProfanity });

			if (!updatedRoom) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to update room filter settings.",
				});
			}

			await broadcastRoomState(roomId);

			return {
				success: true,
				message: `Profanity filter ${filterProfanity ? "enabled" : "disabled"}.`,
				filterProfanity: updatedRoom.filterProfanity,
			};
		}),

	sendFriendRequest: protectedProcedure
		.input(sendFriendRequestSchema)
		.mutation(async ({ input, ctx }) => {
			const { friendId } = input;
			const userId = ctx.session.user.id;

			if (userId === friendId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You cannot send a friend request to yourself.",
				});
			}

			const [targetUser] = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(user.id, friendId));

			if (!targetUser) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "User not found.",
				});
			}

			const [existingFriendship] = await db
				.select()
				.from(friendship)
				.where(
					or(
						and(
							eq(friendship.userId, userId),
							eq(friendship.friendId, friendId),
						),
						and(
							eq(friendship.userId, friendId),
							eq(friendship.friendId, userId),
						),
					),
				)
				.limit(1);

			if (existingFriendship) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Friendship request already exists or users are already friends.",
				});
			}

			const [newFriendship] = await db
				.insert(friendship)
				.values({
					userId: userId,
					friendId: friendId,
					status: "pending",
				})
				.returning();

			return {
				success: true,
				message: "Friend request sent successfully.",
				friendship: newFriendship,
			};
		}),

	getFriendRequests: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.session.user.id;

		const friendRequests = await db
			.select({
				id: friendship.userId,
				userId: friendship.userId,
				friendId: friendship.friendId,
				status: friendship.status,
				createdAt: friendship.createdAt,
				senderUsername: user.username,
			})
			.from(friendship)
			.innerJoin(user, eq(user.id, friendship.userId))
			.where(eq(friendship.friendId, userId));

		return {
			success: true,
			friendRequests: friendRequests,
		};
	}),

	acceptFriendRequest: protectedProcedure
		.input(acceptFriendRequestSchema)
		.mutation(async ({ input, ctx }) => {
			const { friendshipUserId } = input;
			const userId = ctx.session.user.id;

			const [existingFriendship] = await db
				.select()
				.from(friendship)
				.where(
					and(
						eq(friendship.userId, friendshipUserId),
						eq(friendship.friendId, userId),
						eq(friendship.status, "pending"),
					),
				)
				.limit(1);

			if (!existingFriendship) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Friend request not found or already processed.",
				});
			}

			const [updatedFriendship] = await db
				.update(friendship)
				.set({ status: "accepted" })
				.where(
					and(
						eq(friendship.userId, friendshipUserId),
						eq(friendship.friendId, userId),
					),
				)
				.returning();

			return {
				success: true,
				message: "Friend request accepted successfully.",
				friendship: updatedFriendship,
			};
		}),

	declineFriendRequest: protectedProcedure
		.input(declineFriendRequestSchema)
		.mutation(async ({ input, ctx }) => {
			const { friendshipUserId } = input;
			const userId = ctx.session.user.id;

			const [existingFriendship] = await db
				.select()
				.from(friendship)
				.where(
					and(
						eq(friendship.userId, friendshipUserId),
						eq(friendship.friendId, userId),
						eq(friendship.status, "pending"),
					),
				)
				.limit(1);

			if (!existingFriendship) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Friend request not found or already processed.",
				});
			}

			await db
				.delete(friendship)
				.where(
					and(
						eq(friendship.userId, friendshipUserId),
						eq(friendship.friendId, userId),
					),
				);

			return {
				success: true,
				message: "Friend request declined successfully.",
			};
		}),

	getFriends: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.session.user.id;

		const friendships = await db
			.select({
				friendId: friendship.friendId,
				userId: friendship.userId,
				status: friendship.status,
				friendUsername: user.username,
				friendImage: user.image,
			})
			.from(friendship)
			.innerJoin(
				user,
				or(
					and(eq(friendship.userId, userId), eq(user.id, friendship.friendId)),
					and(eq(friendship.friendId, userId), eq(user.id, friendship.userId)),
				),
			)
			.where(
				or(
					and(eq(friendship.userId, userId), eq(friendship.status, "accepted")),
					and(
						eq(friendship.friendId, userId),
						eq(friendship.status, "accepted"),
					),
				),
			);

		return await Promise.all(
			friendships.map(async (f) => {
				const friendUserId = f.userId === userId ? f.friendId : f.userId;

				const activeRoom = await getUserActiveRoom(friendUserId);
				let roomInfo = null;

				if (activeRoom) {
					const [roomDetails] = await db
						.select({
							joinCode: room.joinCode,
							isActive: room.isActive,
						})
						.from(room)
						.where(eq(room.id, activeRoom.roomId))
						.limit(1);

					if (roomDetails?.isActive) {
						roomInfo = {
							joinCode: roomDetails.joinCode,
						};
					}
				}

				return {
					id: friendUserId,
					username: f.friendUsername,
					image: f.friendImage,
					activeRoom: roomInfo,
				};
			}),
		);
	}),

	removeFriend: protectedProcedure
		.input(removeFriendSchema)
		.mutation(async ({ input, ctx }) => {
			const { friendId } = input;
			const userId = ctx.session.user.id;

			if (userId === friendId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You cannot remove yourself as a friend.",
				});
			}

			const [existingFriendship] = await db
				.select()
				.from(friendship)
				.where(
					and(
						eq(friendship.status, "accepted"),
						or(
							and(
								eq(friendship.userId, userId),
								eq(friendship.friendId, friendId),
							),
							and(
								eq(friendship.userId, friendId),
								eq(friendship.friendId, userId),
							),
						),
					),
				)
				.limit(1);

			if (!existingFriendship) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Friendship not found.",
				});
			}

			await db
				.delete(friendship)
				.where(
					or(
						and(
							eq(friendship.userId, userId),
							eq(friendship.friendId, friendId),
						),
						and(
							eq(friendship.userId, friendId),
							eq(friendship.friendId, userId),
						),
					),
				);

			return {
				success: true,
				message: "Friend removed successfully.",
			};
		}),

	addFriendByCode: protectedProcedure
		.input(addFriendByCodeSchema)
		.mutation(async ({ input, ctx }) => {
			const { friendCode } = input;
			const userId = ctx.session.user.id;

			const [targetUser] = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(user.friendCode, friendCode));

			if (!targetUser) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "User with that friend code not found.",
				});
			}

			if (userId === targetUser.id) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You cannot add yourself as a friend.",
				});
			}

			const [existingFriendship] = await db
				.select()
				.from(friendship)
				.where(
					or(
						and(
							eq(friendship.userId, userId),
							eq(friendship.friendId, targetUser.id),
						),
						and(
							eq(friendship.userId, targetUser.id),
							eq(friendship.friendId, userId),
						),
					),
				)
				.limit(1);

			if (existingFriendship) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You are already friends with this user.",
				});
			}

			const [newFriendship] = await db
				.insert(friendship)
				.values({
					userId: userId,
					friendId: targetUser.id,
					status: "accepted",
				})
				.returning();

			return {
				success: true,
				message: "Friend added successfully!",
				friendship: newFriendship,
			};
		}),
});
