import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { room, roomMember } from "../db/schema/rooms";
import {
	cleanupRoomMessages,
	deleteRoomMembers,
	setRoomMember,
	updateRoomMemberActiveStatus,
} from "../lib/redis";
import type { RoomMemberInfo } from "../lib/redis";
import { s3Client } from "../lib/s3";
import { protectedProcedure, publicProcedure, router } from "../lib/trpc";
import { broadcastRoomClosed, broadcastRoomState } from "../lib/ws";

const createRoomSchema = z.object({
	players: z.number().min(2, "Minimum 2 players").max(8, "Maximum 8 players"),
	startingStack: z.number().positive("Starting stack must be positive"),
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
			const [newRoom] = await db
				.insert(room)
				.values({
					maxPlayers: input.players,
					startingStack: input.startingStack,
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

			await cleanupRoomMessages(input.roomId);
			await deleteRoomMembers(input.roomId);
			await db.delete(roomMember).where(eq(roomMember.roomId, input.roomId));
			await db.delete(room).where(eq(room.id, input.roomId));

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

			if (existingMember) {
				if (existingMember.isActive) {
					memberInfo = {
						userId: existingMember.userId,
						username: username,
						seatNumber: existingMember.seatNumber,
						currentStack: existingMember.currentStack,
						isActive: true,
					};
					await db
						.update(roomMember)
						.set({ isActive: true })
						.where(eq(roomMember.id, existingMember.id));
				} else {
					await db
						.update(roomMember)
						.set({ isActive: true })
						.where(eq(roomMember.id, existingMember.id));

					memberInfo = {
						userId: existingMember.userId,
						username: username,
						seatNumber: existingMember.seatNumber,
						currentStack: existingMember.currentStack,
						isActive: true,
					};
				}
			} else {
				const [{ count }] = await db
					.select({
						count: sql<number>`count(*)::int`,
					})
					.from(roomMember)
					.where(
						and(
							eq(roomMember.roomId, targetRoom.id),
							eq(roomMember.isActive, true),
						),
					);

				if (count >= targetRoom.maxPlayers) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Room is full",
					});
				}

				const takenSeats = await db
					.select({ seatNumber: roomMember.seatNumber })
					.from(roomMember)
					.where(
						and(
							eq(roomMember.roomId, targetRoom.id),
							eq(roomMember.isActive, true),
						),
					);

				const occupiedSeats = new Set(
					takenSeats.map((seat) => seat.seatNumber),
				);
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
						currentStack: targetRoom.startingStack,
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
				};
			}

			await setRoomMember(targetRoom.id, memberInfo);
			await broadcastRoomState(targetRoom.id);

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
				.returning({ id: roomMember.id });

			if (!updatedMember) {
				console.warn(
					`User ${userId} tried to leave room ${roomId} but was not found or already inactive.`,
				);

				return { success: true };
			}

			await updateRoomMemberActiveStatus(roomId, userId, false);
			await broadcastRoomState(roomId);

			return { success: true };
		}),

	getRooms: protectedProcedure.query(async ({ ctx }) => {
		const roomsData = await db
			.select({
				id: room.id,
				joinCode: room.joinCode,
				maxPlayers: room.maxPlayers,
				startingStack: room.startingStack,
				isActive: room.isActive,
				createdAt: room.createdAt,
				ownerId: room.ownerId,
				memberId: roomMember.id,
				memberUserId: roomMember.userId,
				memberJoinedAt: roomMember.joinedAt,
				memberCurrentStack: roomMember.currentStack,
				memberIsActive: roomMember.isActive,
				memberSeatNumber: roomMember.seatNumber,
				memberUsername: user.username,
				memberImage: user.image,
			})
			.from(room)
			.leftJoin(roomMember, eq(roomMember.roomId, room.id))
			.leftJoin(user, eq(roomMember.userId, user.id))
			.orderBy(desc(room.createdAt));

		interface GroupedRoom {
			id: string;
			joinCode: string;
			maxPlayers: number;
			startingStack: number;
			isActive: boolean;
			createdAt: Date;
			ownerId: string;
			members: Array<{
				id: string;
				userId: string;
				username: string | null;
				image: string | null;
				joinedAt: Date;
				currentStack: number;
				isActive: boolean;
				seatNumber: number;
			}>;
		}

		const groupedRooms = roomsData.reduce<Record<string, GroupedRoom>>(
			(acc, row) => {
				const roomId = row.id;
				if (!acc[roomId]) {
					acc[roomId] = {
						id: row.id,
						joinCode: row.joinCode,
						maxPlayers: row.maxPlayers,
						startingStack: row.startingStack,
						isActive: row.isActive,
						createdAt: row.createdAt,
						ownerId: row.ownerId,
						members: [],
					};
				}
				if (row.memberId && row.memberUserId) {
					acc[roomId].members.push({
						id: row.memberId,
						userId: row.memberUserId,
						username: row.memberUsername,
						image: row.memberImage,
						joinedAt: row.memberJoinedAt ?? new Date(),
						currentStack: row.memberCurrentStack ?? 0,
						isActive: row.memberIsActive ?? false,
						seatNumber: row.memberSeatNumber ?? 0,
					});
				}
				return acc;
			},
			{},
		);

		const userRooms = Object.values(groupedRooms).filter(
			(r) =>
				r.ownerId === ctx.session.user.id ||
				r.members.some((m) => m.userId === ctx.session.user.id && m.isActive),
		);

		return userRooms;
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
				const existingKey = userProfile.image.split("/").pop();
				if (existingKey) {
					try {
						await s3Client.send(
							new DeleteObjectCommand({
								Bucket: "nostakes",
								Key: existingKey,
							}),
						);
					} catch (error) {
						console.error("Failed to delete old image:", error);
					}
				}
			}

			let imageUrl: string | null = null;
			if (input.image) {
				const buffer = Buffer.from(
					input.image.replace(/^data:image\/\w+;base64,/, ""),
					"base64",
				);

				const key = `${nanoid()}.jpg`;

				await s3Client.send(
					new PutObjectCommand({
						Bucket: "nostakes",
						Key: key,
						Body: buffer,
						ContentType: "image/jpeg",
					}),
				);

				imageUrl = `https://image.nostakes.poker/nostakes/${key}`;
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
});

export type AppRouter = typeof appRouter;
