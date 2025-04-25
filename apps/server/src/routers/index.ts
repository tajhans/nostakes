import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { room, roomMember } from "../db/schema/rooms";
import {
	getNextActivePlayerSeat,
	isBettingRoundOver,
	startNewHand,
} from "../lib/poker";
import {
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
} from "../lib/ws";

const createRoomSchema = z.object({
	players: z.number().min(2, "Minimum 2 players").max(8, "Maximum 8 players"),
	startingStack: z.number().positive("Starting stack must be positive"),
	smallBlind: z.number().positive("Small blind must be positive"),
	bigBlind: z.number().positive("Big blind must be positive"),
	ante: z.number().min(0, "Ante cannot be negative").default(5),
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

			broadcastRoomClosed(input.roomId);

			await Promise.all([
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

			const gameState = await getGameState(roomId);
			let gameStatePromise = Promise.resolve();

			if (gameState?.playerStates[userId]) {
				const playerState = gameState.playerStates[userId];
				if (!playerState.isFolded && !playerState.isSittingOut) {
					playerState.isFolded = true;
					playerState.isSittingOut = true;
					gameState.handHistory.push(
						`Seat ${playerState.seatNumber} left the room and folded.`,
					);

					if (gameState.currentPlayerSeat === playerState.seatNumber) {
						gameState.currentPlayerSeat = getNextActivePlayerSeat(
							gameState,
							playerState.seatNumber,
						);
						if (gameState.currentPlayerSeat) {
							gameState.handHistory.push(
								`Seat ${gameState.currentPlayerSeat} is now next to act.`,
							);
						} else {
							if (isBettingRoundOver(gameState)) {
								gameState.handHistory.push("Betting round concluded.");
							} else {
								console.log(
									`No next player found after Seat ${playerState.seatNumber} left and folded.`,
								);
							}
						}
					}
					gameStatePromise = setGameState(roomId, gameState);
				} else {
					playerState.isSittingOut = true;
					gameStatePromise = setGameState(roomId, gameState);
				}
			}

			await gameStatePromise;
			await Promise.all([
				broadcastRoomState(roomId),
				broadcastGameState(roomId),
			]);

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
			const userProfile = await db
				.select({ image: user.image })
				.from(user)
				.where(eq(user.id, ctx.session.user.id))
				.limit(1)
				.then((rows) => rows[0]);

			if (userProfile?.image) {
				try {
					const urlParts = userProfile.image.split("/");
					const existingKey = urlParts[urlParts.length - 1];
					if (existingKey) {
						await s3Client.send(
							new DeleteObjectCommand({
								Bucket: "nostakes",
								Key: existingKey,
							}),
						);
						console.log(`Deleted old image: ${existingKey}`);
					}
				} catch (error) {
					console.error("Failed to delete old image from R2:", error);
				}
			}

			let imageUrl: string | null = null;
			if (input.image) {
				const buffer = Buffer.from(
					input.image.replace(/^data:image\/\w+;base64,/, ""),
					"base64",
				);
				const key = `${nanoid()}.jpg`;

				try {
					await s3Client.send(
						new PutObjectCommand({
							Bucket: "nostakes",
							Key: key,
							Body: buffer,
							ContentType: "image/jpeg",
						}),
					);

					imageUrl = `https://image.nostakes.poker/nostakes/${key}`;
					console.log(`Uploaded new image: ${imageUrl}`);
				} catch (error) {
					console.error("Failed to upload image to R2:", error);
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Failed to upload profile picture.",
					});
				}
			}

			await db
				.update(user)
				.set({
					image: imageUrl,
					updatedAt: new Date(),
				})
				.where(eq(user.id, ctx.session.user.id));

			return { imageUrl };
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
});

export type AppRouter = typeof appRouter;
