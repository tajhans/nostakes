import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { db } from "../db";
import { user } from "../db/schema/auth";

export async function getUserSessionData(
	userId: string,
): Promise<{ imageBase64: string | null; friendCode: string | null }> {
	try {
		const [userData] = await db
			.select({
				imageBase64: user.imageBase64,
				friendCode: user.friendCode,
			})
			.from(user)
			.where(eq(user.id, userId))
			.limit(1);

		return {
			imageBase64: userData?.imageBase64 ?? null,
			friendCode: userData?.friendCode ?? null,
		};
	} catch (error) {
		console.error(`Failed to get session data for user ${userId}:`, error);
		return {
			imageBase64: null,
			friendCode: null,
		};
	}
}

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
export const generateCode = () => customAlphabet(alphabet, 8)();
