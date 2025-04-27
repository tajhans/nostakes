import { AccountSkeleton } from "@/components/account-skeleton";
import { ImageUpload } from "@/components/image-upload";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { trpcClient } from "@/utils/trpc";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/account")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const [isSigningOut, setIsSigningOut] = useState(false);
	const navigate = Route.useNavigate();

	const updateProfile = useMutation({
		mutationFn: async (image: string) => {
			return trpcClient.updateProfile.mutate({ image });
		},
		onSuccess: (data) => {
			if (data.imageUrl) {
				toast.success(
					"Profile picture updated, refresh the page to see changes.",
				);
			}
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	useEffect(() => {
		if (!session && !isPending) {
			navigate({
				to: "/login",
			});
		}
	}, [session, isPending, navigate]);

	if (isPending) {
		return <AccountSkeleton />;
	}

	if (!session?.user) {
		return null;
	}

	return (
		<div className="container mx-auto max-w-3xl px-4 py-8">
			<div className="space-y-6 rounded-lg border p-6">
				<div className="flex items-center gap-6">
					<div className="shrink-0">
						{session.user.image ? (
							<img
								src={session.user.image}
								alt={session.user.username || ""}
								className="h-24 w-24 rounded-full object-cover"
							/>
						) : (
							<div className="flex h-24 w-24 items-center justify-center rounded-full bg-accent">
								<span className="font-medium text-2xl">
									{session.user.username?.charAt(0).toUpperCase() || "?"}
								</span>
							</div>
						)}
					</div>
					<div className="min-w-0 flex-1">
						<h1 className="font-bold text-2xl">{session.user.username}</h1>
						<p className="text-muted-foreground">{session.user.email}</p>
					</div>
				</div>

				<div className="space-y-4">
					<h2 className="font-medium text-lg">Profile Picture</h2>
					<ImageUpload
						onImageSelect={(base64) => updateProfile.mutate(base64)}
					/>
				</div>

				<div className="border-t pt-6">
					<Button
						variant="destructive"
						onClick={() => {
							setIsSigningOut(true);
							authClient.signOut({
								fetchOptions: {
									onSuccess: () => {
										toast.success("Sign out successful");
										navigate({
											to: "/",
										});
									},
									onError: (error) => {
										toast.error(error.error.message);
										setIsSigningOut(false);
									},
								},
							});
						}}
						disabled={isSigningOut}
					>
						{isSigningOut ? "Signing Out..." : "Sign Out"}
					</Button>
				</div>
			</div>
		</div>
	);
}
