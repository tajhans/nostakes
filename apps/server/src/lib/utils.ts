import { eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";

export async function getUserImageBase64(
	userId: string,
): Promise<string | null> {
	try {
		const [userData] = await db
			.select({
				imageBase64: user.imageBase64,
			})
			.from(user)
			.where(eq(user.id, userId))
			.limit(1);

		if (userData) {
			return userData.imageBase64 ?? null;
		}

		return null;
	} catch (error) {
		console.error(`Failed to get imageBase64 for user ${userId}:`, error);
		return null;
	}
}
