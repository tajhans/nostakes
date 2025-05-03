import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";

export const Route = createFileRoute("/reset-password")({
	component: RouteComponent,
});

function RouteComponent() {
	const navigate = useNavigate();
	const { data: session, isPending } = authClient.useSession();

	useEffect(() => {
		if (session && !isPending) {
			navigate({
				to: "/",
			});
		}
	}, [session, isPending, navigate]);

	const token = new URLSearchParams(window.location.search).get("token");

	const form = useForm({
		defaultValues: {
			password: "",
			confirmPassword: "",
		},
		onSubmit: async ({ value }) => {
			if (!token) {
				toast.error("Missing reset token. Please use a valid reset link.");
				return;
			}

			await authClient.resetPassword(
				{
					newPassword: value.password,
					token,
				},
				{
					onSuccess: () => {
						toast.success("Password reset successful! You can now log in.");
						navigate({
							to: "/login",
						});
					},
					onError: (error) => {
						toast.error(error.error.message);
					},
				},
			);
		},
		validators: {
			onSubmit: z
				.object({
					password: z.string().min(6, "Password must be at least 6 characters"),
					confirmPassword: z.string(),
				})
				.refine((data) => data.password === data.confirmPassword, {
					message: "Passwords do not match",
					path: ["confirmPassword"],
				}),
		},
	});

	if (!token) {
		return (
			<div className="mx-auto mt-10 w-full max-w-md p-6">
				<h1 className="mb-6 text-center font-bold text-3xl">
					Invalid Reset Link
				</h1>
				<p className="text-center text-muted-foreground">
					This password reset link is invalid or has expired. Please request a
					new password reset.
				</p>
				<div className="mt-6 flex justify-center">
					<Button onClick={() => navigate({ to: "/forgot-password" })}>
						Request New Reset Link
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto mt-10 w-full max-w-md p-6">
			<h1 className="mb-6 text-center font-bold text-3xl">Reset Password</h1>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					void form.handleSubmit();
				}}
				className="space-y-4"
			>
				<form.Field name="password">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor={field.name}>New Password</Label>
							<Input
								id={field.name}
								name={field.name}
								type="password"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
							/>
							{field.state.meta.errors?.map((error) => (
								<p key={error?.message} className="text-red-500 text-sm">
									{error?.message}
								</p>
							))}
						</div>
					)}
				</form.Field>

				<form.Field name="confirmPassword">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor={field.name}>Confirm Password</Label>
							<Input
								id={field.name}
								name={field.name}
								type="password"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
							/>
							{field.state.meta.errors?.map((error) => (
								<p key={error?.message} className="text-red-500 text-sm">
									{error?.message}
								</p>
							))}
						</div>
					)}
				</form.Field>

				<form.Subscribe>
					{(state) => (
						<Button
							type="submit"
							className="w-full"
							disabled={!state.canSubmit || state.isSubmitting}
						>
							{state.isSubmitting ? "Resetting..." : "Reset Password"}
						</Button>
					)}
				</form.Subscribe>
			</form>
		</div>
	);
}
