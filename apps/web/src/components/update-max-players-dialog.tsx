import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc, trpcClient } from "@/utils/trpc";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";

interface UpdateMaxPlayersDialogProps {
	roomId: string;
	currentMaxPlayers: number;
	currentActivePlayers: number;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function UpdateMaxPlayersDialog({
	roomId,
	currentMaxPlayers,
	currentActivePlayers,
	open,
	onOpenChange,
}: UpdateMaxPlayersDialogProps) {
	const queryClient = useQueryClient();

	const updateMaxPlayersMutation = useMutation({
		mutationFn: async (data: { roomId: string; newMaxPlayers: number }) => {
			return trpcClient.updateMaxPlayers.mutate(data);
		},
		onSuccess: (data) => {
			toast.success(data.message);
			queryClient.invalidateQueries({ queryKey: trpc.getRooms.queryKey() });
			form.reset();
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(`Update failed: ${error.message}`);
		},
	});

	const validationSchema = z.object({
		newMaxPlayers: z
			.number({ message: "Must be a number." })
			.int("Must be a whole number.")
			.min(
				currentMaxPlayers + 1,
				`Must be greater than current max (${currentMaxPlayers}).`,
			)
			.min(
				currentActivePlayers,
				`Cannot be less than active players (${currentActivePlayers}).`,
			)
			.max(8, "Cannot exceed 8 players."),
	});

	const form = useForm({
		defaultValues: {
			newMaxPlayers: currentMaxPlayers + 1,
		},
		onSubmit: async ({ value }) => {
			await updateMaxPlayersMutation.mutateAsync({
				roomId,
				newMaxPlayers: value.newMaxPlayers,
			});
		},
		validators: {
			onChange: validationSchema,
		},
	});

	useEffect(() => {
		form.reset();
		form.setFieldValue("newMaxPlayers", currentMaxPlayers + 1);
	}, [currentMaxPlayers, form]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<DialogHeader>
						<DialogTitle>Update Maximum Players</DialogTitle>
						<DialogDescription>
							Increase the maximum number of players allowed in the room.
							Current max: {currentMaxPlayers}. Active players:{" "}
							{currentActivePlayers}.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<form.Field name="newMaxPlayers">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor={field.name}>New Maximum Players (2-8)</Label>
									<Input
										id={field.name}
										name={field.name}
										type="number"
										value={field.state.value <= 0 ? "" : field.state.value}
										onBlur={field.handleBlur}
										onChange={(e) =>
											field.handleChange(
												e.target.value === ""
													? 0
													: Number.parseInt(e.target.value, 10),
											)
										}
										min={Math.max(currentMaxPlayers + 1, currentActivePlayers)}
										max={8}
										step={1}
										placeholder={`Enter number > ${currentMaxPlayers} (max 8)`}
									/>
									{field.state.meta.errors ? (
										<p className="text-red-500 text-sm">
											{field.state.meta.errors.join(", ")}
										</p>
									) : null}
								</div>
							)}
						</form.Field>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<form.Subscribe>
							{(state) => (
								<Button
									type="submit"
									disabled={
										!state.canSubmit ||
										state.isSubmitting ||
										updateMaxPlayersMutation.isPending
									}
								>
									{updateMaxPlayersMutation.isPending
										? "Updating..."
										: "Update Max Players"}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
