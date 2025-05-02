import { AccountSkeleton } from "@/components/account-skeleton";
import { ImageUpload } from "@/components/image-upload";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { trpcClient } from "@/utils/trpc";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

export const Route = createFileRoute("/account")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const [isSigningOut, setIsSigningOut] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const navigate = useNavigate();

	const updateProfile = useMutation({
		mutationFn: async (image: string | null) => {
			return trpcClient.updateProfile.mutate({ image });
		},
		onSuccess: (data) => {
			toast.success(
				data.imageUrl
					? "Profile picture updated. Refresh may be needed."
					: "Profile picture removed. Refresh may be needed.",
			);
		},
		onError: (error) => {
			toast.error(`Failed to update profile: ${error.message}`);
		},
	});

	const checkCanDelete = useMutation({
		mutationFn: async () => {
			return trpcClient.checkCanDeleteAccount.mutate();
		},
	});

	const handleDeleteAccount = async () => {
		if (!session?.user?.email) {
			toast.error("Cannot delete account: Email not found.");
			return;
		}
		setIsDeleting(true);
		try {
			await checkCanDelete.mutateAsync();

			await authClient.deleteUser({
				callbackURL: `${window.location.origin}/`,
			});
			toast.success(
				"Account deletion email sent. Please check your inbox to confirm.",
			);
			setIsDeleteDialogOpen(false);
		} catch (error: unknown) {
			console.error("Account deletion process error:", error);

			let errorMessage = "Failed to initiate account deletion.";
			if (error instanceof Error) {
				errorMessage = error.message;
			} else if (
				typeof error === "object" &&
				error !== null &&
				"message" in error &&
				typeof error.message === "string"
			) {
				errorMessage = error.message;
			} else if (typeof error === "string") {
				errorMessage = error;
			}

			toast.error(errorMessage);
		} finally {
			setIsDeleting(false);
		}
	};

	const emailForm = useForm({
		defaultValues: {
			newEmail: "",
		},
		onSubmit: async ({ value }) => {
			await authClient.changeEmail(
				{
					newEmail: value.newEmail,
					callbackURL: `${window.location.origin}/account`,
				},
				{
					onSuccess: () => {
						toast.success(
							`Verification email sent to ${session?.user?.email}. Please check your inbox to confirm the change to ${value.newEmail}.`,
						);
						emailForm.reset();
					},
					onError: (error) => {
						toast.error(`Failed to change email: ${error.error.message}`);
					},
				},
			);
		},
		validators: {
			onSubmit: z.object({
				newEmail: z.string().email("Please enter a valid email address."),
			}),
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
					<div className="relative shrink-0">
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

				<Separator />

				<div className="space-y-4">
					<h2 className="font-medium text-lg">Profile Picture</h2>
					<div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
						<ImageUpload
							onImageSelect={(base64) => updateProfile.mutate(base64)}
						/>
						{session.user.image && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => updateProfile.mutate(null)}
								disabled={updateProfile.isPending}
							>
								Remove Picture
							</Button>
						)}
					</div>
					{updateProfile.isPending && (
						<p className="text-muted-foreground text-sm">Updating picture...</p>
					)}
				</div>

				<Separator />

				<Accordion type="single" collapsible>
					<AccordionItem value="email-change">
						<AccordionTrigger>Change Email</AccordionTrigger>
						<AccordionContent>
							<div className="space-y-4">
								<p className="text-muted-foreground text-sm">
									A confirmation link will be sent to your current email address
									({session.user.email}) to approve this change.
								</p>
								<form
									onSubmit={(e) => {
										e.preventDefault();
										e.stopPropagation();
										void emailForm.handleSubmit();
									}}
									className="flex flex-col items-start gap-4 sm:flex-row sm:items-end"
								>
									<emailForm.Field name="newEmail">
										{(field) => (
											<div className="w-full space-y-2 sm:w-auto sm:flex-1">
												<Label htmlFor={field.name}>New Email Address</Label>
												<Input
													id={field.name}
													name={field.name}
													type="email"
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(e) => field.handleChange(e.target.value)}
													placeholder="m@example.com"
												/>
												{field.state.meta.errors?.length > 0 ? (
													<p className="text-red-500 text-sm">
														{String(field.state.meta.errors[0])}
													</p>
												) : null}
											</div>
										)}
									</emailForm.Field>
									<emailForm.Subscribe>
										{(state) => (
											<Button
												type="submit"
												disabled={!state.canSubmit || state.isSubmitting}
												className="w-full sm:w-auto"
											>
												{state.isSubmitting
													? "Sending..."
													: "Request Email Change"}
											</Button>
										)}
									</emailForm.Subscribe>
								</form>
							</div>
						</AccordionContent>
					</AccordionItem>
				</Accordion>

				<Separator />

				<div className="flex flex-wrap items-center justify-between gap-4">
					<Button
						variant="secondary"
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

					<Dialog
						open={isDeleteDialogOpen}
						onOpenChange={setIsDeleteDialogOpen}
					>
						<DialogTrigger asChild>
							<Button variant="destructive" disabled={isDeleting}>
								Delete Account
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Delete Account?</DialogTitle>
								<DialogDescription>
									Are you sure you want to delete your account? This action is
									irreversible. A confirmation email will be sent to{" "}
									<strong>{session.user.email}</strong>.
								</DialogDescription>
							</DialogHeader>
							<DialogFooter>
								<DialogClose asChild>
									<Button variant="outline" disabled={isDeleting}>
										Cancel
									</Button>
								</DialogClose>
								<Button
									variant="destructive"
									onClick={handleDeleteAccount}
									disabled={isDeleting || checkCanDelete.isPending}
								>
									{isDeleting || checkCanDelete.isPending
										? "Processing..."
										: "Confirm Deletion"}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</div>
			</div>
		</div>
	);
}
