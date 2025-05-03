import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

export const Route = createFileRoute("/forgot-password")({
	component: RouteComponent,
});

function RouteComponent() {
	const [emailSent, setEmailSent] = useState(false);
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();

	useEffect(() => {
		if (session && !isPending) {
			navigate({
				to: "/",
			});
		}
	}, [session, isPending, navigate]);

	const form = useForm({
		defaultValues: {
			email: "",
		},
		onSubmit: async ({ value }) => {
			await authClient.forgetPassword(
				{
					email: value.email,
					redirectTo: `${window.location.origin}/reset-password`,
				},
				{
					onSuccess: () => {
						setEmailSent(true);
						toast.success(
							"If an account exists with this email, you'll receive password reset instructions.",
						);
					},
					onError: (error) => {
						toast.error(error.error.message);
					},
				},
			);
		},
		validators: {
			onSubmit: z.object({
				email: z.string().email("Please enter a valid email address."),
			}),
		},
	});

	if (emailSent) {
		return (
			<div className="mx-auto mt-10 w-full max-w-md p-6">
				<h1 className="mb-6 text-center font-bold text-3xl">
					Check Your Email
				</h1>
				<p className="text-center text-muted-foreground">
					If an account exists with that email address, you'll receive
					instructions to reset your password.
				</p>
				<div className="mt-6 text-center">
					<Button variant="link" onClick={() => setEmailSent(false)}>
						Try another email
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto mt-10 w-full max-w-md p-6">
			<h1 className="mb-6 text-center font-bold text-3xl">Reset Password</h1>
			<p className="mb-6 text-center text-muted-foreground">
				Enter your email address and we'll send you instructions to reset your
				password.
			</p>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					void form.handleSubmit();
				}}
				className="space-y-4"
			>
				<form.Field name="email">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor={field.name}>Email</Label>
							<Input
								id={field.name}
								name={field.name}
								type="email"
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
							{state.isSubmitting ? "Sending..." : "Send Email"}
						</Button>
					)}
				</form.Subscribe>
			</form>
		</div>
	);
}
