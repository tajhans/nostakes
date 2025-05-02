import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { getPlaiceholder } from "plaiceholder";
import sharp from "sharp";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
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
	updateRoomMemberActiveStatus,
	updateWantsToPlayStatus,
} from "../lib/redis";
import type { RoomMemberInfo } from "../lib/redis";
import { s3Client } from "../lib/s3";
import { protectedProcedure, publicProcedure, router } from "../lib/trpc";
import {
	broadcastGameState,
	broadcastRoomClosed,
	broadcastRoomState,
	broadcastUserKicked,
} from "../lib/ws";

const createRoomSchema = z.object({
	players: z.number().min(2, "Minimum 2 players").max(8, "Maximum 8 players"),
	startingStack: z.number().positive("Starting stack must be positive"),
	smallBlind: z.number().positive("Small blind must be positive"),
	bigBlind: z.number().positive("Big blind must be positive"),
	ante: z.number().min(0, "Ante cannot be negative").default(5),
	filterProfanity: z.boolean().default(false),
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

		const result = userRoomsData.map((r) => {
			const members = membersByRoom[r.id] || [];
			return {
				...r,
				members: members.map((m) => ({
					...m,
					wantsToPlayNextHand: m.wantsToPlayNextHand ?? false,
				})),
			};
		});

		return result;
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

					newImageUrl = oldImageUrl;
					newImageBase64 = oldImageBase64;
					newKey = oldKey;
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
});

export type AppRouter = typeof appRouter;
