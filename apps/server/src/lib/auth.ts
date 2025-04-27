import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { customSession, username } from "better-auth/plugins";
import { db } from "../db";
import * as schema from "../db/schema/auth";
import { sendVerificationEmail } from "./email";
import { getUserImageBase64 } from "./utils";

const options = {
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: schema,
	}),
	trustedOrigins: [process.env.CORS_ORIGIN || ""],
	emailAndPassword: {
		enabled: true,
	},
	emailVerification: {
		sendVerificationEmail: async ({ user, url }) => {
			await sendVerificationEmail({
				email: user.email,
				url,
			});
		},
		sendOnSignUp: false,
		autoSignInAfterVerification: true,
		expiresIn: 3600,
	},
	advanced: {
		crossSubDomainCookies: {
			enabled: true,
		},
	},
	plugins: [username()],
} satisfies BetterAuthOptions;

export const auth = betterAuth({
	...options,
	plugins: [
		username(),
		...(options.plugins ?? []),
		customSession(async ({ user, session }) => {
			const imageBase64 = await getUserImageBase64(session.userId);

			return {
				user: {
					...user,
					imageBase64,
				},
				session,
			};
		}, options),
	],
});
