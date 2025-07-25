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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { UpdateMaxPlayersDialog } from "@/components/update-max-players-dialog";
import { Check, Circle, CircleDot, Copy, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { RoomData, RoomMemberInfo } from "@/types";

interface RoomInfoBarProps {
	room: RoomData;
	roomId: string;
	activeMembers: RoomMemberInfo[];
	isConnected: boolean;
	isAdmin: boolean;
	isHandInProgress: boolean;
	canUpdateMaxPlayers: boolean;
	closeRoom: {
		mutate: (roomId: string) => void;
		isPending: boolean;
	};
	leaveRoom: {
		mutate: (roomId: string) => void;
		isPending: boolean;
	};
	currentUserMemberInfo?: RoomMemberInfo;
}

export function RoomInfoBar({
	room,
	roomId,
	activeMembers,
	isConnected,
	isAdmin,
	isHandInProgress,
	canUpdateMaxPlayers,
	closeRoom,
	leaveRoom,
	currentUserMemberInfo,
}: RoomInfoBarProps) {
	const [maxPlayersDialogOpen, setMaxPlayersDialogOpen] = useState(false);
	const [isCopied, setIsCopied] = useState(false);
	const [isCloseRoomDialogOpen, setIsCloseRoomDialogOpen] = useState(false);
	const [isLeaveRoomDialogOpen, setIsLeaveRoomDialogOpen] = useState(false);

	const handInProgressReason =
		"Cannot perform this action while a hand is in progress.";
	const closeRoomDisabled =
		closeRoom.isPending || !isConnected || isHandInProgress;
	const leaveRoomDisabled =
		leaveRoom.isPending || !isConnected || isHandInProgress;

	const handleCopyCode = async () => {
		if (!room.joinCode) return;
		const codeToCopy = room.joinCode;

		try {
			await navigator.clipboard.writeText(codeToCopy);
			setIsCopied(true);
			toast.success("Room code copied to clipboard!");
			setTimeout(() => setIsCopied(false), 2000);
		} catch (err) {
			console.error(
				"Failed to copy room code using navigator.clipboard: ",
				err,
			);
			const textArea = document.createElement("textarea");
			textArea.value = codeToCopy;
			textArea.style.position = "fixed";
			textArea.style.opacity = "0";
			document.body.appendChild(textArea);
			textArea.focus();
			textArea.select();
			try {
				const successful = document.execCommand("copy");
				if (successful) {
					setIsCopied(true);
					toast.success("Room code copied to clipboard! (fallback)");
					setTimeout(() => setIsCopied(false), 2000);
				} else {
					throw new Error("Fallback copy command failed");
				}
			} catch (fallbackErr) {
				console.error("Fallback copy failed: ", fallbackErr);
				toast.error("Failed to copy room code.");
			} finally {
				document.body.removeChild(textArea);
			}
		}
	};

	return (
		<div className="mb-4 flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex items-center gap-2">
				<span className="font-medium text-sm">Code:</span>
				<div className="flex items-center rounded-md border bg-secondary px-2 py-1">
					<span className="font-mono text-sm tracking-wider">
						{room.joinCode
							? `${room.joinCode.substring(0, 4)}-${room.joinCode.substring(4, 8)}`
							: "N/A"}
					</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="ml-1 h-6 w-6"
								onClick={handleCopyCode}
								disabled={!room.joinCode || isCopied}
							>
								{isCopied ? (
									<Check className="h-4 w-4 text-green-500" />
								) : (
									<Copy className="h-4 w-4" />
								)}
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p>Copy Join Code</p>
						</TooltipContent>
					</Tooltip>
				</div>
				<Tooltip>
					<TooltipTrigger>
						{isConnected ? (
							<CircleDot className="h-4 w-4 text-green-600" />
						) : (
							<Circle className="h-4 w-4 animate-pulse text-red-600" />
						)}
					</TooltipTrigger>
					<TooltipContent>
						<p>{isConnected ? "Connected" : "Disconnected"}</p>
					</TooltipContent>
				</Tooltip>
			</div>

			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-sm">
				<div className="flex items-center gap-1">
					<span>
						Players: {activeMembers.length}/{room.maxPlayers}
					</span>
					{canUpdateMaxPlayers && (
						<>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="p-0"
										onClick={() => setMaxPlayersDialogOpen(true)}
									>
										<Pencil className="h-3 w-3" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Change Room Size</TooltipContent>
							</Tooltip>
							<UpdateMaxPlayersDialog
								roomId={roomId}
								currentMaxPlayers={room.maxPlayers}
								currentActivePlayers={activeMembers.length}
								open={maxPlayersDialogOpen}
								onOpenChange={setMaxPlayersDialogOpen}
							/>
						</>
					)}
				</div>
				<span>Stack: {room.startingStack}</span>
				<span>Small Blind: {room.smallBlind}</span>
				<span>Big Blind: {room.bigBlind}</span>
				<span>Ante: {room.ante}</span>
				<span>Visibility: {room.public ? "Public" : "Private"}</span>
			</div>

			<div className="flex flex-wrap items-center justify-end gap-2">
				{isAdmin && room.isActive && (
					<Dialog
						open={isCloseRoomDialogOpen}
						onOpenChange={setIsCloseRoomDialogOpen}
					>
						<Tooltip>
							<TooltipTrigger asChild>
								<span
									tabIndex={closeRoomDisabled ? 0 : -1}
									className={closeRoomDisabled ? "cursor-not-allowed" : ""}
								>
									<DialogTrigger asChild>
										<Button
											variant="destructive"
											size="sm"
											disabled={closeRoomDisabled}
											aria-disabled={closeRoomDisabled}
											className={
												closeRoomDisabled
													? "pointer-events-none opacity-50"
													: ""
											}
										>
											{closeRoom.isPending ? "Closing..." : "Close Room"}
										</Button>
									</DialogTrigger>
								</span>
							</TooltipTrigger>
							{isHandInProgress && (
								<TooltipContent>
									<p>{handInProgressReason}</p>
								</TooltipContent>
							)}
						</Tooltip>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Close Room?</DialogTitle>
								<DialogDescription>
									Are you sure you want to close this room? All players will be
									removed and the game will end.
								</DialogDescription>
							</DialogHeader>
							<DialogFooter>
								<DialogClose asChild>
									<Button variant="outline">Cancel</Button>
								</DialogClose>
								<Button
									variant="destructive"
									onClick={() => closeRoom.mutate(roomId)}
									disabled={closeRoom.isPending}
								>
									{closeRoom.isPending ? "Closing..." : "Close Room"}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				)}
				{!isAdmin && currentUserMemberInfo?.isActive && (
					<Dialog
						open={isLeaveRoomDialogOpen}
						onOpenChange={setIsLeaveRoomDialogOpen}
					>
						<Tooltip>
							<TooltipTrigger asChild>
								<span
									tabIndex={leaveRoomDisabled ? 0 : -1}
									className={leaveRoomDisabled ? "cursor-not-allowed" : ""}
								>
									<DialogTrigger asChild>
										<Button
											variant="outline"
											size="sm"
											disabled={leaveRoomDisabled}
											aria-disabled={leaveRoomDisabled}
											className={
												leaveRoomDisabled
													? "pointer-events-none opacity-50"
													: ""
											}
										>
											{leaveRoom.isPending ? "Leaving..." : "Leave Room"}
										</Button>
									</DialogTrigger>
								</span>
							</TooltipTrigger>
							{isHandInProgress && (
								<TooltipContent>
									<p>{handInProgressReason}</p>
								</TooltipContent>
							)}
						</Tooltip>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Leave Room?</DialogTitle>
								<DialogDescription>
									Are you sure you want to leave this room? You can rejoin
									later.
								</DialogDescription>
							</DialogHeader>
							<DialogFooter>
								<DialogClose asChild>
									<Button variant="outline">Cancel</Button>
								</DialogClose>
								<Button
									variant="destructive"
									onClick={() => leaveRoom.mutate(roomId)}
									disabled={leaveRoom.isPending}
								>
									{leaveRoom.isPending ? "Leaving..." : "Leave Room"}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				)}
			</div>
		</div>
	);
}
