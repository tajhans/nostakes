import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

console.log("VITE_SERVER_URL:", import.meta.env.VITE_SERVER_URL);

export const authClient = createAuthClient({
	baseURL: import.meta.env.VITE_SERVER_URL,
	plugins: [usernameClient()],
});
