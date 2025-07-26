import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const friendship = pgTable(
	"friendship",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		friendId: text("friend_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		status: text("status", { enum: ["pending", "accepted"] }).notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.friendId] })],
);
