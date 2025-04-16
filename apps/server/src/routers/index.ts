import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { room, roomMember } from "../db/schema/rooms";
import { s3Client } from "../lib/s3";
import { protectedProcedure, publicProcedure, router } from "../lib/trpc";

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

			await db.insert(roomMember).values({
				roomId: newRoom.id,
				userId: ctx.session.user.id,
				currentStack: input.startingStack,
				seatNumber: 1,
			});

			return newRoom;
		}),

	closeRoom: protectedProcedure
		.input(closeRoomSchema)
		.mutation(async ({ input, ctx }) => {
			const [targetRoom] = await db
				.select()
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

			await Promise.all([
				db.delete(room).where(eq(room.id, input.roomId)),
				db.delete(roomMember).where(eq(roomMember.roomId, input.roomId)),
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

			const [existingMember] = await db
				.select()
				.from(roomMember)
				.where(
					and(
						eq(roomMember.roomId, targetRoom.id),
						eq(roomMember.userId, ctx.session.user.id),
					),
				)
				.limit(1);

			if (existingMember) {
				if (existingMember.isActive) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "You are already in this room",
					});
				}

				await db
					.update(roomMember)
					.set({ isActive: true })
					.where(eq(roomMember.id, existingMember.id));

				return targetRoom;
			}

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

			const occupiedSeats = new Set(takenSeats.map((seat) => seat.seatNumber));
			let nextSeat = 1;
			while (occupiedSeats.has(nextSeat)) {
				nextSeat++;
			}

			await db.insert(roomMember).values({
				roomId: targetRoom.id,
				userId: ctx.session.user.id,
				currentStack: targetRoom.startingStack,
				seatNumber: nextSeat,
			});

			return targetRoom;
		}),

	getRooms: protectedProcedure.query(async () => {
		const rooms = await db
			.select({
				id: room.id,
				joinCode: room.joinCode,
				maxPlayers: room.maxPlayers,
				startingStack: room.startingStack,
				isActive: room.isActive,
				createdAt: room.createdAt,
				ownerId: room.ownerId,
				members: roomMember,
			})
			.from(room)
			.leftJoin(roomMember, eq(roomMember.roomId, room.id))
			.orderBy(desc(room.createdAt));

		interface GroupedRoom {
			id: string;
			joinCode: string;
			maxPlayers: number;
			startingStack: number;
			isActive: boolean;
			createdAt: Date;
			ownerId: string;
			members: (typeof roomMember.$inferSelect)[];
		}

		const groupedRooms = rooms.reduce<Record<string, GroupedRoom>>(
			(acc, row) => {
				if (!acc[row.id]) {
					acc[row.id] = {
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
				if (row.members) {
					acc[row.id].members.push(row.members);
				}
				return acc;
			},
			{},
		);

		return Object.values(groupedRooms);
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

				const imageUrl = `https://image.nostakes.poker/nostakes/${key}`;
				await db
					.update(user)
					.set({
						image: imageUrl,
						updatedAt: new Date(),
					})
					.where(eq(user.id, ctx.session.user.id));

				return { imageUrl };
			}

			return { imageUrl: null };
		}),
});

export type AppRouter = typeof appRouter;
