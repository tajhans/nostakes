import {
	boolean,
	integer,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { customAlphabet, nanoid } from "nanoid";
import { user } from "./auth";

const alphabet =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const generateJoinCode = () => customAlphabet(alphabet, 8)();

export const room = pgTable("room", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => nanoid()),
	joinCode: text("join_code")
		.notNull()
		.unique()
		.$defaultFn(() => generateJoinCode()),
	createdAt: timestamp("created_at")
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: timestamp("updated_at")
		.notNull()
		.$defaultFn(() => new Date()),
	maxPlayers: integer("max_players").notNull(),
	startingStack: integer("starting_stack").notNull(),
	isActive: boolean("is_active").notNull().default(true),
	ownerId: text("owner_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

export const roomMember = pgTable("room_member", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => nanoid()),
	roomId: text("room_id")
		.notNull()
		.references(() => room.id, { onDelete: "cascade" }),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	joinedAt: timestamp("joined_at")
		.notNull()
		.$defaultFn(() => new Date()),
	currentStack: integer("current_stack").notNull(),
	isActive: boolean("is_active").notNull().default(true),
	seatNumber: integer("seat_number").notNull(),
});
