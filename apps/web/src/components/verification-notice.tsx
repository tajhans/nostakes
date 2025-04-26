import { authClient } from "@/lib/auth-client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";

export function VerificationNotice() {
	const [isSending, setIsSending] = useState(false);
	const { data: session } = authClient.useSession();

	if (!session || session.user.emailVerified) {
		return null;
	}

	return (
		<div className="flex items-center justify-between gap-4 border border-yellow-500/20 bg-yellow-500/10 px-4 py-2 text-yellow-500">
			<p className="text-sm">
				Please verify your email address to access all features.
			</p>
			<Button
				variant="outline"
				size="sm"
				className="border-yellow-500/20 text-yellow-500 hover:bg-yellow-500/10"
				disabled={isSending}
				onClick={async () => {
					setIsSending(true);
					try {
						await authClient.sendVerificationEmail({
							email: session?.user.email,
							callbackURL: import.meta.env.VITE_SERVER_URL,
						});
						toast.success("Verification email sent");
					} catch (error) {
						toast.error("Failed to send verification email");
					} finally {
						setIsSending(false);
					}
				}}
			>
				{isSending ? "Sending..." : "Send Email"}
			</Button>
		</div>
	);
}
