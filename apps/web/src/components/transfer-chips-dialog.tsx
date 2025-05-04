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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { RoomMemberInfo } from "@/types";
import { trpcClient } from "@/utils/trpc";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

interface TransferChipsDialogProps {
	roomId: string;
	currentUserId: string;
	members: RoomMemberInfo[];
	currentUserStack: number;
	disabled?: boolean;
	disabledReason?: string;
}

export function TransferChipsDialog({
	roomId,
	currentUserId,
	members,
	currentUserStack,
	disabled = false,
	disabledReason = "",
}: TransferChipsDialogProps) {
	const [isOpen, setIsOpen] = useState(false);

	const transferChipsMutation = useMutation({
		mutationFn: async (data: {
			roomId: string;
			recipientUserId: string;
			amount: number;
		}) => {
			return trpcClient.transferChips.mutate(data);
		},
		onSuccess: (data) => {
			toast.success(data.message);
			form.reset();
			setIsOpen(false);
		},
		onError: (error) => {
			toast.error(`Transfer failed: ${error.message}`);
		},
	});

	const validationSchema = z.object({
		recipientUserId: z.string().min(1, "Please select a recipient."),
		amount: z
			.number({ message: "Amount must be a number." })
			.int("Amount must be a whole number.")
			.positive("Amount must be positive.")
			.max(
				currentUserStack,
				`Amount cannot exceed your stack (${currentUserStack}).`,
			),
	});

	const form = useForm({
		defaultValues: {
			recipientUserId: "",
			amount: 0,
		},
		onSubmit: async ({ value }) => {
			await transferChipsMutation.mutateAsync({
				roomId,
				recipientUserId: value.recipientUserId,
				amount: value.amount,
			});
		},
		validators: {
			onChange: validationSchema,
		},
	});

	const potentialRecipients = members.filter(
		(m) => m.userId !== currentUserId && m.isActive,
	);

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<span
							tabIndex={disabled ? 0 : -1}
							className={disabled ? "cursor-not-allowed" : ""}
						>
							<DialogTrigger asChild>
								<Button
									variant="outline"
									size="sm"
									disabled={disabled}
									aria-disabled={disabled}
									className={disabled ? "pointer-events-none opacity-50" : ""}
								>
									Transfer Chips
								</Button>
							</DialogTrigger>
						</span>
					</TooltipTrigger>
					{disabled && disabledReason && (
						<TooltipContent>
							<p>{disabledReason}</p>
						</TooltipContent>
					)}
				</Tooltip>
			</TooltipProvider>
			<DialogContent>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<DialogHeader>
						<DialogTitle>Transfer Chips</DialogTitle>
						<DialogDescription>
							Send chips to another player in the room. Your current stack:{" "}
							{currentUserStack}
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<form.Field name="recipientUserId">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor={field.name}>Recipient</Label>
									<Select
										value={field.state.value}
										onValueChange={field.handleChange}
										name={field.name}
										disabled={potentialRecipients.length === 0}
									>
										<SelectTrigger id={field.name}>
											<SelectValue placeholder="Select a player" />
										</SelectTrigger>
										<SelectContent>
											{potentialRecipients.length > 0 ? (
												potentialRecipients.map((member) => (
													<SelectItem key={member.userId} value={member.userId}>
														{member.username} ({member.currentStack})
													</SelectItem>
												))
											) : (
												<SelectItem value="-" disabled>
													No eligible recipients
												</SelectItem>
											)}
										</SelectContent>
									</Select>
									{field.state.meta.errors ? (
										<p className="text-red-500 text-sm">
											{field.state.meta.errors
												.map((err) => String(err))
												.join(", ")}
										</p>
									) : null}
								</div>
							)}
						</form.Field>
						<form.Field name="amount">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor={field.name}>Amount</Label>
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
										min={1}
										max={currentUserStack}
										step={1}
										placeholder="Enter amount"
									/>
									{field.state.meta.errors
										.map((err) => err?.message ?? String(err))
										.join(", ")}
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
										transferChipsMutation.isPending
									}
								>
									{transferChipsMutation.isPending
										? "Transferring..."
										: "Transfer"}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
