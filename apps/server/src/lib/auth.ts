import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { customSession, username } from "better-auth/plugins";
import { db } from "../db";
import * as schema from "../db/schema/auth";
import {
	sendChangeEmailVerification,
	sendDeleteAccountVerification,
	sendResetPassword,
	sendVerificationEmail,
} from "./email";
import { getUserSessionData } from "./utils";

const options = {
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: schema,
	}),
	trustedOrigins: [process.env.CORS_ORIGIN || ""],
	emailAndPassword: {
		enabled: true,
		sendResetPassword: async ({ user, url }) => {
			await sendResetPassword({ email: user.email, url });
		},
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
	user: {
		deleteUser: {
			enabled: true,
			sendDeleteAccountVerification: async ({ user, url }) => {
				await sendDeleteAccountVerification({ email: user.email, url });
			},
		},
		changeEmail: {
			enabled: true,
			sendChangeEmailVerification: async ({ user, newEmail, url }) => {
				await sendChangeEmailVerification({
					oldEmail: user.email,
					newEmail,
					url,
				});
			},
		},
	},
	advanced: {
		crossSubDomainCookies: {
			enabled: true,
		},
		cookiePrefix: "nostakes",
	},
	plugins: [username()],
} satisfies BetterAuthOptions;

export const auth = betterAuth({
	...options,
	plugins: [
		...(options.plugins ?? []),
		customSession(async ({ user, session }) => {
			const userData = await getUserSessionData(session.userId);

			return {
				user: {
					...user,
					imageBase64: userData.imageBase64,
					friendCode: userData.friendCode,
				},
				session,
			};
		}, options),
	],
});
