import { Button } from "@/components/ui/button";
import {
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSeparator,
	InputOTPSlot,
} from "@/components/ui/input-otp";
import { trpc, trpcClient } from "@/utils/trpc";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

const joinRoomSchema = z.object({
	joinCode: z.string().length(8, "Room code must be 8 characters"),
});

type JoinRoomFormData = z.infer<typeof joinRoomSchema>;

export default function JoinRoomForm() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const joinRoom = useMutation({
		mutationFn: async (data: JoinRoomFormData) => {
			return trpcClient.joinRoom.mutate(data);
		},
		onSuccess: (room) => {
			toast.success("Joined room successfully");
			queryClient.invalidateQueries({ queryKey: trpc.getRooms.queryKey() });
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
							<div className="flex flex-col items-center gap-4">
								<InputOTP
									maxLength={8}
									value={field.state.value}
									onChange={(value) => field.handleChange(value)}
								>
									<InputOTPGroup>
										<InputOTPSlot index={0} />
										<InputOTPSlot index={1} />
										<InputOTPSlot index={2} />
										<InputOTPSlot index={3} />
									</InputOTPGroup>
									<InputOTPSeparator />
									<InputOTPGroup>
										<InputOTPSlot index={4} />
										<InputOTPSlot index={5} />
										<InputOTPSlot index={6} />
										<InputOTPSlot index={7} />
									</InputOTPGroup>
								</InputOTP>
								{field.state.meta.errors ? (
									<div role="alert" className="text-red-500 text-sm">
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
