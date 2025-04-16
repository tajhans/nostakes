import { Button } from "@/components/ui/button";
import {
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpcClient } from "@/utils/trpc";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

const joinRoomSchema = z.object({
	joinCode: z.string().min(1, "Join code is required"),
});

type JoinRoomFormData = z.infer<typeof joinRoomSchema>;

export default function JoinRoomForm() {
	const navigate = useNavigate();

	const joinRoom = useMutation({
		mutationFn: async (data: JoinRoomFormData) => {
			return trpcClient.joinRoom.mutate(data);
		},
		onSuccess: (room) => {
			toast.success("Joined room successfully");
			navigate({ to: "/room", search: { id: room.id } });
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const form = useForm({
		defaultValues: {
			joinCode: "",
		},
		onSubmit: async ({ value }) => {
			await joinRoom.mutateAsync(value);
		},
	});

	return (
		<DialogContent>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					void form.handleSubmit();
				}}
				className="grid gap-6"
			>
				<DialogHeader>
					<DialogTitle>Join Room</DialogTitle>
					<DialogDescription>
						Enter the room code to join a poker game.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					<form.Field name="joinCode">
						{(field) => (
							<div className="grid grid-cols-4 items-center gap-4">
								<Label htmlFor={field.name} className="text-right">
									Room Code
								</Label>
								<Input
									id={field.name}
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
									className="col-span-3"
									placeholder="Enter room code"
								/>
								{field.state.meta.errors ? (
									<div
										role="alert"
										className="col-span-3 col-start-2 text-red-500 text-sm"
									>
										{field.state.meta.errors.join(", ")}
									</div>
								) : null}
							</div>
						)}
					</form.Field>
				</div>
				<DialogFooter>
					<form.Subscribe>
						{(state) => (
							<Button
								type="submit"
								disabled={!state.canSubmit || state.isSubmitting}
							>
								{state.isSubmitting ? "Joining..." : "Join Room"}
							</Button>
						)}
					</form.Subscribe>
				</DialogFooter>
			</form>
		</DialogContent>
	);
}
