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
import { Switch } from "@/components/ui/switch";
import { trpcClient } from "@/utils/trpc";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

const createRoomSchema = z.object({
	players: z
		.number({ message: "Must be a number" })
		.min(2, "Minimum 2 players")
		.max(8, "Maximum 8 players"),
	startingStack: z
		.number({ message: "Must be a number" })
		.positive("Starting stack must be positive"),
	smallBlind: z
		.number({ message: "Must be a number" })
		.positive("Small blind must be positive"),
	bigBlind: z
		.number({ message: "Must be a number" })
		.positive("Big blind must be positive"),
	ante: z
		.number({ message: "Must be a number" })
		.positive("Big blind must be positive")
		.default(5),
	filterProfanity: z.boolean().default(false),
});

type CreateRoomFormData = z.infer<typeof createRoomSchema>;

export default function CreateRoomForm() {
	const navigate = useNavigate();

	const createRoom = useMutation({
		mutationFn: async (data: CreateRoomFormData) => {
			return trpcClient.createRoom.mutate(data);
		},
		onSuccess: (room) => {
			toast.success("Room created successfully");
			navigate({ to: "/room", search: { id: room.id } });
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const form = useForm({
		defaultValues: {
			players: 2,
			startingStack: 1000,
			smallBlind: 10,
			bigBlind: 20,
			ante: 5,
			filterProfanity: false,
		},
		onSubmit: async ({ value }) => {
			console.log(value);
			await createRoom.mutateAsync(value);
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
					<DialogTitle>Create New Poker Room</DialogTitle>
					<DialogDescription>
						Configure the settings for your new poker room.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					<form.Field name="players">
						{(field) => (
							<div className="grid grid-cols-4 items-center gap-4">
								<Label htmlFor={field.name} className="text-right">
									Players
								</Label>
								<Input
									id={field.name}
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.valueAsNumber)}
									type="number"
									className="col-span-3"
									min={2}
									max={8}
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
					<form.Field name="startingStack">
						{(field) => (
							<div className="grid grid-cols-4 items-center gap-4">
								<Label htmlFor={field.name} className="text-right">
									Starting Stack
								</Label>
								<Input
									id={field.name}
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.valueAsNumber)}
									type="number"
									className="col-span-3"
									min={1}
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
					<form.Field name="smallBlind">
						{(field) => (
							<div className="grid grid-cols-4 items-center gap-4">
								<Label htmlFor={field.name} className="text-right">
									Small Blind
								</Label>
								<Input
									id={field.name}
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.valueAsNumber)}
									type="number"
									className="col-span-3"
									min={1}
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
					<form.Field name="bigBlind">
						{(field) => (
							<div className="grid grid-cols-4 items-center gap-4">
								<Label htmlFor={field.name} className="text-right">
									Big Blind
								</Label>
								<Input
									id={field.name}
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.valueAsNumber)}
									type="number"
									className="col-span-3"
									min={1}
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
					<form.Field name="ante">
						{(field) => (
							<div className="grid grid-cols-4 items-center gap-4">
								<Label htmlFor={field.name} className="text-right">
									Ante
								</Label>
								<Input
									id={field.name}
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.valueAsNumber)}
									type="number"
									className="col-span-3"
									min={0}
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
					<form.Field name="filterProfanity">
						{(field) => (
							<div className="grid grid-cols-4 items-center gap-4">
								<Label htmlFor={field.name} className="text-right">
									Filter Profanity
								</Label>
								<div className="col-span-3 flex items-center">
									<Switch
										id={field.name}
										name={field.name}
										checked={field.state.value}
										onCheckedChange={field.handleChange}
									/>
								</div>
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
								{state.isSubmitting ? "Creating..." : "Create Room"}
							</Button>
						)}
					</form.Subscribe>
				</DialogFooter>
			</form>
		</DialogContent>
	);
}
