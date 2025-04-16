import { authClient } from "@/lib/auth-client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";

export function VerificationNotice() {
	const [isResending, setIsResending] = useState(false);
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
				disabled={isResending}
				onClick={async () => {
					setIsResending(true);
					try {
						await authClient.sendVerificationEmail({
							email: session?.user.email,
							callbackURL: "http://100.119.141.108:3001/",
						});
						toast.success("Verification email sent");
					} catch (error) {
						toast.error("Failed to send verification email");
					} finally {
						setIsResending(false);
					}
				}}
			>
				{isResending ? "Sending..." : "Resend Email"}
			</Button>
		</div>
	);
}
