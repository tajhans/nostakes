import { HandHistory } from "@/components/hand-history";
import { suitMap } from "@/components/hand-history";
import { RoomChat } from "@/components/room-chat";
import { RoomInfoBar } from "@/components/room-info-bar";
import { RoomSkeleton } from "@/components/room-skeleton";
import { TransferChipsDialog } from "@/components/transfer-chips-dialog";
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
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import { evaluateHand } from "@/lib/poker";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/utils/trpc";
import { trpcClient } from "@/lib/utils/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TRPCClientError } from "@trpc/client";
import { applyPatch } from "fast-json-patch";
import { UserX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type {
	CardComponentProps,
	ChatMessage,
	ClientChatMessage,
	ClientPokerAction,
	GameState,
	RoomData,
	RoomMemberInfo,
	ServerWebSocketMessage,
} from "@/types";

const CardComponent: React.FC<CardComponentProps> = ({
	rank,
	suit,
	size = "md",
}) => {
	const sizeClasses = {
		sm: "h-8 w-[1.5rem] text-xs",
		md: "h-12 w-[2.25rem] text-sm",
		lg: "h-28  w-[5.25rem] text-lg",
	};

	const suitInfo = suitMap[suit];
	const altText = `${rank} of ${suitInfo.char}`;

	return (
		<div
			className={cn(
				"flex select-none items-center justify-center rounded border bg-card text-card-foreground",
				sizeClasses[size],
			)}
			aria-label={altText}
		>
			<span
				className={cn("font-semibold", suitInfo.colorClass)}
				title={altText}
			>
				{rank}
				{suitInfo.char}
			</span>
		</div>
	);
};

export const Route = createFileRoute("/room")({
	validateSearch: (search) => ({
		id: search.id as string,
	}),
	component: RouteComponent,
});

function RouteComponent() {
	const { id: roomId } = Route.useSearch();
	const { data: session, isPending: isSessionPending } =
		authClient.useSession();
	const navigate = useNavigate({ from: Route.fullPath });
	const queryClient = useQueryClient();

	const [members, setMembers] = useState<RoomMemberInfo[]>([]);
	const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
	const [isConnected, setIsConnected] = useState(false);
	const [gameState, setGameState] = useState<GameState | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const [betAmount, setBetAmount] = useState<number>(0);
	const hasShownInitialConnectToast = useRef(false);
	const reconnectAttempt = useRef(0);
	const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
	const [userToKick, setUserToKick] = useState<RoomMemberInfo | null>(null);

	const {
		data: initialRoomData,
		isLoading: isRoomLoading,
		isError: isRoomError,
		error: roomError,
	} = useQuery({
		...trpc.getRooms.queryOptions(),
		enabled: !!session && !!roomId,
		select: (data): RoomData | undefined => data.find((r) => r.id === roomId),
		staleTime: 5 * 60 * 1000,
		gcTime: 10 * 60 * 1000,
		retry: (failureCount, error: unknown) => {
			if (error instanceof TRPCClientError) {
				const code = error.data?.code;
				if (code === "NOT_FOUND" || code === "UNAUTHORIZED") {
					return false;
				}
			}
			return failureCount < 3;
		},
	});

	const startGame = useMutation({
		mutationFn: async (rId: string) =>
			trpcClient.startGame.mutate({ roomId: rId }),
		onSuccess: () => toast.success("Game started!"),
		onError: (error) => toast.error(`Failed to start game: ${error.message}`),
	});

	const closeRoom = useMutation({
		mutationFn: async (rId: string) =>
			trpcClient.closeRoom.mutate({ roomId: rId }),
		onSuccess: () => {
			toast.success("Room closed successfully");
		},
		onError: (error) => {
			toast.error(`Failed to close room: ${error.message}`);
		},
	});

	const leaveRoom = useMutation({
		mutationFn: async (rId: string) =>
			trpcClient.leaveRoom.mutate({ roomId: rId }),
		onSuccess: () => {
			toast.success("You have left the room.");
			navigate({ to: "/" });
		},
		onError: (error) => {
			toast.error(`Failed to leave room: ${error.message}`);
		},
	});

	const togglePlay = useMutation({
		mutationFn: async (variables: { roomId: string; wantsToPlay: boolean }) =>
			trpcClient.togglePlayStatus.mutate(variables),
		onSuccess: (_, variables) => {
			const actionText = variables.wantsToPlay ? "IN" : "OUT";
			const typeText = (initialRoomData?.ante ?? 0) > 0 ? "ante" : "hand";
			toast.success(`You are now ${actionText} for the next ${typeText}.`);
			setMembers((prevMembers) =>
				prevMembers.map((m) =>
					m.userId === session?.user?.id
						? { ...m, wantsToPlayNextHand: variables.wantsToPlay }
						: m,
				),
			);
		},
		onError: (error) =>
			toast.error(`Failed to update status: ${error.message}`),
	});

	const kickUser = useMutation({
		mutationFn: async (variables: { roomId: string; userIdToKick: string }) =>
			trpcClient.kickUser.mutate(variables),
		onSuccess: (_, variables) => {
			toast.success(
				`Successfully kicked user ${members.find((m) => m.userId === variables.userIdToKick)?.username || "User"}.`,
			);
			setUserToKick(null);
		},
		onError: (error) => {
			toast.error(`Failed to kick user: ${error.message}`);
			setUserToKick(null);
		},
	});

	const updateFilter = useMutation({
		mutationFn: async (variables: {
			roomId: string;
			filterProfanity: boolean;
		}) => trpcClient.updateRoomFilter.mutate(variables),
		onSuccess: (data) => {
			toast.success(data.message);
			queryClient.invalidateQueries({ queryKey: trpc.getRooms.queryKey() });
		},
		onError: (error) =>
			toast.error(`Failed to update filter: ${error.message}`),
	});

	const isHandInProgress =
		!!gameState &&
		gameState.phase !== "waiting" &&
		gameState.phase !== "end_hand";
	const loggedInUserPlayerState =
		gameState?.playerStates[session?.user?.id ?? ""];
	const loggedInUserHoleCards = loggedInUserPlayerState?.hand;
	const communityCards = gameState?.communityCards;

	const bestHandDisplayData = useMemo(() => {
		if (
			loggedInUserHoleCards &&
			loggedInUserHoleCards.length === 2 &&
			communityCards
		) {
			return evaluateHand(loggedInUserHoleCards, communityCards);
		}
		return null;
	}, [loggedInUserHoleCards, communityCards]);

	useEffect(() => {
		if (reconnectTimeout.current) {
			clearTimeout(reconnectTimeout.current);
			reconnectTimeout.current = null;
		}
		if (isSessionPending) return;
		if (!session?.user?.id || !session?.user?.username) {
			navigate({ to: "/login" });
			return;
		}
		if (!roomId) return;

		if (wsRef.current) {
			wsRef.current.close(1000, "Reconnecting or dependencies changed");
			wsRef.current = null;
			setIsConnected(false);
		}

		const serverUrlString = import.meta.env.VITE_SERVER_URL;
		if (!serverUrlString) {
			toast.error("Configuration error. Cannot connect.");
			return;
		}
		let wsUrl: string;
		try {
			const serverUrl = new URL(serverUrlString);
			const wsProtocol = serverUrl.protocol === "https:" ? "wss" : "ws";
			wsUrl = `${wsProtocol}://${serverUrl.host}/ws?roomId=${roomId}&userId=${session.user.id}&username=${encodeURIComponent(session.user.username)}`;
		} catch (e) {
			toast.error("Invalid server configuration.");
			return;
		}

		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		ws.onopen = () => {
			if (wsRef.current === ws) {
				setIsConnected(true);
				reconnectAttempt.current = 0;
				if (!hasShownInitialConnectToast.current) {
					toast.success("Connected to room.");
					hasShownInitialConnectToast.current = true;
				}
			} else {
				ws.close(1000, "Stale connection opened");
			}
		};
		ws.onmessage = (event: MessageEvent) => {
			if (wsRef.current !== ws) return;
			try {
				const data: ServerWebSocketMessage = JSON.parse(event.data);
				switch (data.type) {
					case "chat":
						setChatMessages((prev) =>
							[...prev, data].sort((a, b) => a.timestamp - b.timestamp),
						);
						break;
					case "history":
						setChatMessages(
							data.messages.sort((a, b) => a.timestamp - b.timestamp),
						);
						break;
					case "room_state": {
						const processedMembers = data.members.map((member) => ({
							...member,
							wantsToPlayNextHand: member.wantsToPlayNextHand ?? false,
							joinedAt: member.joinedAt ? new Date(member.joinedAt) : undefined,
						}));
						setMembers(processedMembers);
						break;
					}
					case "room_closed":
						toast.info("The room has been closed by the owner.");
						if (wsRef.current === ws)
							wsRef.current.close(1000, "Room closed by owner");
						navigate({ to: "/" });
						break;
					case "game_state":
						setGameState(data.gameState);
						if (
							data.gameState.currentPlayerSeat !== gameState?.currentPlayerSeat
						) {
							setBetAmount(0);
						}
						break;
					case "game_state_patch":
						setGameState((currentState) => {
							if (!currentState) return null;
							try {
								const { newDocument } = applyPatch(
									currentState,
									data.patches,
									true,
									false,
								);
								if (
									data.patches.some(
										(p) =>
											p.path === "/phase" || p.path === "/currentPlayerSeat",
									)
								) {
									setBetAmount(0);
								}
								return newDocument as GameState;
							} catch (error) {
								toast.error(
									"Game state update error. State may be out of sync.",
								);
								return currentState;
							}
						});
						break;
					case "user_kicked":
						toast.warning(`You have been kicked: ${data.reason}`);
						if (wsRef.current === ws)
							wsRef.current.close(1000, "Kicked by owner");
						navigate({ to: "/" });
						break;
					case "error":
						toast.error(`Server error: ${data.message}`);
						break;
					default:
						console.warn("Received unknown WebSocket message type:", data);
				}
			} catch (error) {
				toast.error("Received invalid data from server.");
			}
		};
		ws.onclose = (event: CloseEvent) => {
			if (wsRef.current === ws) {
				setIsConnected(false);
				wsRef.current = null;
				const normalClosureCodes = [1000, 1001, 1005];
				const expectedReasons = [
					"Room closed by owner",
					"Client navigating away",
					"Reconnecting or dependencies changed",
					"Prerequisites became unmet",
					"New connection established",
					"Configuration error",
					"Stale connection opened",
					"Kicked by owner",
				];
				if (
					!normalClosureCodes.includes(event.code) &&
					!expectedReasons.includes(event.reason)
				) {
					toast.error(
						`Connection lost (Code: ${event.code}). Attempting to reconnect...`,
					);
					hasShownInitialConnectToast.current = false;
					const delay = Math.min(30000, 2 ** reconnectAttempt.current * 1000);
					reconnectAttempt.current += 1;
					if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
					reconnectTimeout.current = setTimeout(() => {}, delay);
				} else if (event.reason && !expectedReasons.includes(event.reason)) {
					toast.info(`Disconnected: ${event.reason}`);
				} else if (!normalClosureCodes.includes(event.code)) {
					toast.info(`Disconnected (Code: ${event.code})`);
				}
			}
		};
		ws.onerror = () => {
			if (wsRef.current === ws) toast.error("WebSocket connection error.");
		};
		return () => {
			if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
			if (wsRef.current === ws && ws.readyState < WebSocket.CLOSING) {
				ws.close(1000, "Client navigating away");
			}
			if (wsRef.current === ws) wsRef.current = null;
		};
	}, [
		roomId,
		session?.user?.id,
		session?.user?.username,
		isSessionPending,
		navigate,
		gameState?.currentPlayerSeat,
	]);

	useEffect(() => {
		if (initialRoomData?.members && members.length === 0) {
			const processedInitialMembers = initialRoomData.members.map((member) => ({
				...member,
				wantsToPlayNextHand: member.wantsToPlayNextHand ?? false,
				joinedAt: member.joinedAt ? new Date(member.joinedAt) : undefined,
			}));
			setMembers(processedInitialMembers);
		}
	}, [initialRoomData, members.length]);

	const sendMessage = (message: ClientChatMessage | ClientPokerAction) => {
		if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify(message));
		} else {
			toast.error("Cannot send message. Connection not active.");
		}
	};
	const sendChatMessage = (messageText: string) => {
		if (messageText.trim())
			sendMessage({ type: "chat", message: messageText.trim() });
	};

	const handleFold = () => sendMessage({ type: "action", action: "fold" });
	const handleCheck = () => sendMessage({ type: "action", action: "check" });
	const handleCall = () => sendMessage({ type: "action", action: "call" });
	const handleBet = () => {
		const amount = Math.floor(betAmount);
		if (amount > 0 && gameState && initialRoomData) {
			const playerState = gameState.playerStates[session?.user?.id ?? ""];
			if (!playerState) return;
			const minBetValue = Math.max(
				1,
				Math.min(initialRoomData.bigBlind, playerState.stack),
			);
			if (amount >= minBetValue && amount <= playerState.stack) {
				sendMessage({ type: "action", action: "bet", amount: amount });
			} else {
				toast.error(
					`Invalid bet amount (Min: ${minBetValue}, Max: ${playerState.stack})`,
				);
			}
		} else {
			toast.error("Invalid bet amount");
		}
	};
	const handleRaise = () => {
		const amount = Math.floor(betAmount);
		if (gameState && initialRoomData) {
			const playerState = gameState.playerStates[session?.user?.id ?? ""];
			if (!playerState) return;
			const currentBetVal = gameState.currentBet;
			const minRaiseAmountVal = gameState.minRaiseAmount;
			const playerCurrentBetVal = playerState.currentBet;
			const minRaiseToValue = Math.min(
				currentBetVal + minRaiseAmountVal,
				playerState.stack + playerCurrentBetVal,
			);
			const maxRaiseValue = playerState.stack + playerCurrentBetVal;
			if (amount >= minRaiseToValue && amount <= maxRaiseValue) {
				sendMessage({ type: "action", action: "raise", amount: amount });
			} else {
				toast.error(
					`Invalid raise amount (Min: ${minRaiseToValue}, Max: ${maxRaiseValue})`,
				);
			}
		} else {
			toast.error("Invalid raise amount");
		}
	};

	if (isSessionPending) return <RoomSkeleton />;
	if (!session?.user) {
		return (
			<div className="container p-4 text-center">
				Please log in to view rooms.
				<Button onClick={() => navigate({ to: "/login" })} className="ml-2">
					Login
				</Button>
			</div>
		);
	}
	if (roomId && isRoomLoading) return <RoomSkeleton />;
	if (roomId && isRoomError) {
		const isNotFoundError =
			roomError instanceof TRPCClientError &&
			roomError.data?.code === "NOT_FOUND";
		return (
			<div className="container mx-auto px-4 py-8 text-center">
				<h1 className="mb-4 font-bold text-destructive text-xl">Error</h1>
				<p className="text-muted-foreground">
					{isNotFoundError
						? "The room was not found."
						: "Failed to load room data."}
				</p>
				<Button onClick={() => navigate({ to: "/" })} className="mt-4">
					Go to Home
				</Button>
			</div>
		);
	}
	if (roomId && !isRoomLoading && !initialRoomData) {
		return (
			<div className="container mx-auto px-4 py-8 text-center">
				<h1 className="mb-4 font-bold text-xl">Room Not Found</h1>
				<p className="text-muted-foreground">
					The room ID might be incorrect, or the room no longer exists.
				</p>
				<Button onClick={() => navigate({ to: "/" })} className="mt-4">
					Go to Home
				</Button>
			</div>
		);
	}
	if (!initialRoomData)
		return (
			<div className="container mx-auto px-4 py-8 text-center">
				<h1 className="mb-4 font-bold text-destructive text-xl">
					Error Displaying Room
				</h1>
				<Button onClick={() => navigate({ to: "/" })} className="mt-4">
					Go to Home
				</Button>
			</div>
		);

	const room = initialRoomData;
	const activeMembers = members.filter((m) => m.isActive);
	const isAdmin = session.user.id === room.ownerId;
	const readyPlayerCount = activeMembers.filter(
		(m) => m.wantsToPlayNextHand === true,
	).length;
	const canUpdateMaxPlayers =
		isAdmin && room.isActive && room.maxPlayers < 8 && isConnected;
	const canStartGame =
		isAdmin &&
		room.isActive &&
		isConnected &&
		(!gameState ||
			gameState.phase === "waiting" ||
			gameState.phase === "end_hand") &&
		readyPlayerCount >= 2;
	const startGameButtonTitle = !isAdmin
		? "Only the admin can start the game"
		: !room.isActive
			? "Room is closed"
			: !isConnected
				? "Not connected to server"
				: gameState &&
						gameState.phase !== "waiting" &&
						gameState.phase !== "end_hand"
					? "Game is already in progress"
					: readyPlayerCount < 2
						? `Need at least 2 players ready (${readyPlayerCount} ready)`
						: "Start the next hand";
	const currentPlayerState = gameState?.playerStates[session.user.id];
	const isMyTurn =
		!!currentPlayerState &&
		gameState?.currentPlayerSeat === currentPlayerState?.seatNumber &&
		!currentPlayerState?.isFolded &&
		!currentPlayerState?.isAllIn &&
		!currentPlayerState?.isSittingOut;
	const currentUserMemberInfo = members.find(
		(m) => m.userId === session.user.id,
	);
	const showPlayButton =
		room.isActive &&
		currentUserMemberInfo?.isActive &&
		(!gameState ||
			gameState.phase === "waiting" ||
			gameState.phase === "end_hand");
	const wantsToPlay = currentUserMemberInfo?.wantsToPlayNextHand === true;
	const playButtonText =
		room.ante > 0
			? wantsToPlay
				? `Retract Ante (${room.ante})`
				: `Post Ante (${room.ante})`
			: wantsToPlay
				? "Leave Next Hand"
				: "Enter Next Hand";
	const currentBet = gameState?.currentBet ?? 0;
	const minRaiseAmount = gameState?.minRaiseAmount ?? room.bigBlind;
	const playerCurrentBet = currentPlayerState?.currentBet ?? 0;
	const playerStack = currentPlayerState?.stack ?? 0;
	const canCheck = isMyTurn && currentBet === playerCurrentBet;
	const canCall = isMyTurn && currentBet > playerCurrentBet && playerStack > 0;
	const canBet = isMyTurn && currentBet === 0 && playerStack > 0;
	const canRaise =
		isMyTurn && currentBet > 0 && playerStack > currentBet - playerCurrentBet;
	const callAmount = Math.min(currentBet - playerCurrentBet, playerStack);
	const minBetValue = Math.max(1, Math.min(room.bigBlind, playerStack));
	const minRaiseToValue = Math.min(
		currentBet + minRaiseAmount,
		playerStack + playerCurrentBet,
	);
	const maxBetOrRaiseValue = playerStack + playerCurrentBet;
	const handInProgressReason =
		"Cannot perform this action while a hand is in progress.";
	const transferChipsDisabled =
		!isConnected || isHandInProgress || !currentUserMemberInfo?.isActive;
	const transferChipsDisabledReason = !isConnected
		? "Not connected to server"
		: isHandInProgress
			? handInProgressReason
			: !currentUserMemberInfo?.isActive
				? "You are not active in the room"
				: "";

	return (
		<TooltipProvider>
			<div className="container mx-auto max-w-5xl px-4 py-2">
				<RoomInfoBar
					room={room}
					roomId={roomId}
					activeMembers={activeMembers}
					isConnected={isConnected}
					isAdmin={isAdmin}
					isHandInProgress={isHandInProgress}
					canUpdateMaxPlayers={canUpdateMaxPlayers}
					closeRoom={closeRoom}
					leaveRoom={leaveRoom}
					currentUserMemberInfo={currentUserMemberInfo}
				/>

				<div className="grid gap-4 lg:grid-cols-[1fr_400px]">
					<div className="space-y-4">
						<div className="rounded-lg border p-4">
							<div className="mb-2 flex items-center justify-between">
								<h2 className="font-medium">Players</h2>
								{currentUserMemberInfo?.isActive && (
									<TransferChipsDialog
										roomId={roomId}
										currentUserId={session.user.id}
										members={members}
										currentUserStack={currentUserMemberInfo.currentStack}
										disabled={transferChipsDisabled}
										disabledReason={transferChipsDisabledReason}
									/>
								)}
							</div>
							{members.length > 0 ? (
								<div className="grid gap-2">
									{members
										.sort((a, b) => a.seatNumber - b.seatNumber)
										.map((member) => {
											const playerState =
												gameState?.playerStates[member.userId];
											const isDealer =
												gameState?.dealerSeat === member.seatNumber;
											const isSB =
												gameState?.smallBlindSeat === member.seatNumber;
											const isBB =
												gameState?.bigBlindSeat === member.seatNumber;
											const isCurrent =
												gameState?.currentPlayerSeat === member.seatNumber &&
												playerState &&
												!playerState.isFolded &&
												!playerState.isAllIn &&
												!playerState.isSittingOut;
											const canKick =
												isAdmin &&
												member.userId !== session.user.id &&
												member.isActive;
											const kickDisabled =
												!canKick || isHandInProgress || kickUser.isPending;
											const displayStack =
												gameState &&
												playerState &&
												gameState.phase !== "waiting" &&
												gameState.phase !== "end_hand"
													? playerState.stack
													: member.currentStack;
											const memberWantsToPlay =
												member.wantsToPlayNextHand === true;
											const playStatusText =
												room.ante > 0 ? "Ante Posted" : "Playing Next";

											return (
												<div
													key={member.userId}
													className={cn(
														"flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded p-2 transition-all",
														member.isActive
															? "bg-accent/50"
															: "bg-muted/30 opacity-60",
														isCurrent
															? "ring-2 ring-primary ring-offset-1 ring-offset-background"
															: "",
													)}
												>
													<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
														<span className="w-14 flex-shrink-0 text-muted-foreground text-xs">
															Seat {member.seatNumber}
															{isDealer && " (D)"}
															{isSB && " (SB)"}
															{isBB && " (BB)"}
														</span>
														<span className="font-medium text-sm">
															{member.username ||
																`User ${member.userId.substring(0, 4)}`}
															{member.userId === room.ownerId ? " (Admin)" : ""}
															{member.userId === session.user.id
																? " (You)"
																: ""}
														</span>
														{!member.isActive && (
															<span className="rounded bg-destructive/20 px-1.5 py-0.5 text-destructive text-xs">
																Left
															</span>
														)}
														{playerState?.isFolded && (
															<span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
																Folded
															</span>
														)}
														{playerState?.isAllIn && (
															<span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-xs text-yellow-500">
																ALL-IN
															</span>
														)}
														{memberWantsToPlay &&
															showPlayButton &&
															member.isActive && (
																<span className="rounded bg-green-500/20 px-1.5 py-0.5 text-green-600 text-xs">
																	{playStatusText}
																</span>
															)}
														{member.userId === session.user.id &&
															((playerState?.hand &&
																playerState.hand.length > 0 &&
																!playerState.isFolded) ||
																(bestHandDisplayData &&
																	bestHandDisplayData.bestHand.length ===
																		5)) && (
																<div className="ml-1 flex flex-col items-center">
																	<div className="flex items-center gap-1">
																		{playerState?.hand?.map((c, index) => (
																			<CardComponent
																				key={`${c.rank}${c.suit}-${index}`}
																				rank={c.rank}
																				suit={c.suit}
																				size="lg"
																			/>
																		))}
																	</div>
																	{bestHandDisplayData &&
																		bestHandDisplayData.bestHand.length ===
																			5 && (
																			<p className="mt-1 text-muted-foreground text-xs">
																				{bestHandDisplayData.rankName}
																			</p>
																		)}
																</div>
															)}
														{(playerState?.currentBet ?? 0) > 0 && (
															<span className="rounded bg-primary/20 px-1.5 py-0.5 font-mono text-xs">
																Bet: {playerState?.currentBet}
															</span>
														)}
													</div>
													<div className="flex items-center gap-2">
														<span className="font-mono text-sm">
															{displayStack}
														</span>
														{canKick && (
															<Dialog
																open={userToKick?.userId === member.userId}
																onOpenChange={(isOpen) => {
																	if (!isOpen) setUserToKick(null);
																}}
															>
																<Tooltip>
																	<TooltipTrigger asChild>
																		<span
																			tabIndex={kickDisabled ? 0 : -1}
																			className={
																				kickDisabled ? "cursor-not-allowed" : ""
																			}
																		>
																			<DialogTrigger asChild>
																				<Button
																					variant="ghost"
																					size="icon"
																					className={cn(
																						"h-6 w-6 text-destructive hover:bg-destructive/10",
																						kickDisabled
																							? "pointer-events-none opacity-50"
																							: "",
																					)}
																					onClick={() => setUserToKick(member)}
																					disabled={kickDisabled}
																					aria-disabled={kickDisabled}
																				>
																					<UserX className="h-4 w-4" />
																				</Button>
																			</DialogTrigger>
																		</span>
																	</TooltipTrigger>
																	<TooltipContent>
																		{isHandInProgress ? (
																			<p>{handInProgressReason}</p>
																		) : (
																			<p>Kick {member.username}</p>
																		)}
																	</TooltipContent>
																</Tooltip>
																<DialogContent>
																	<DialogHeader>
																		<DialogTitle>Kick Player?</DialogTitle>
																		<DialogDescription>
																			Are you sure you want to kick{" "}
																			<strong>{userToKick?.username}</strong>{" "}
																			from the room?
																		</DialogDescription>
																	</DialogHeader>
																	<DialogFooter>
																		<DialogClose asChild>
																			<Button variant="outline">Cancel</Button>
																		</DialogClose>
																		<Button
																			variant="destructive"
																			onClick={() => {
																				if (userToKick)
																					kickUser.mutate({
																						roomId,
																						userIdToKick: userToKick.userId,
																					});
																			}}
																			disabled={kickUser.isPending}
																		>
																			{kickUser.isPending
																				? "Kicking..."
																				: "Kick Player"}
																		</Button>
																	</DialogFooter>
																</DialogContent>
															</Dialog>
														)}
													</div>
												</div>
											);
										})}
								</div>
							) : (
								<p className="text-muted-foreground text-sm">
									No players in the room yet.
								</p>
							)}
						</div>

						<div className="flex min-h-[300px] flex-col rounded-lg border p-4">
							<div className="text-center">
								<h2 className="mb-4 font-medium">
									Game Phase:{" "}
									<span className="font-semibold">
										{gameState?.phase?.replace(/_/g, " ").toUpperCase() ??
											"WAITING"}
									</span>
								</h2>
								{gameState ? (
									<>
										<div className="mb-4">
											<h3 className="mb-1 font-medium text-sm">
												Community Cards
											</h3>
											<div className="flex min-h-[7rem] flex-wrap items-center justify-center gap-2">
												{gameState.communityCards.length > 0 ? (
													gameState.communityCards.map((card, index) => (
														<CardComponent
															key={`${card.rank}${card.suit}-${index}`}
															rank={card.rank}
															suit={card.suit}
															size="lg"
														/>
													))
												) : (
													<span className="text-muted-foreground text-sm">
														-- No cards dealt --
													</span>
												)}
											</div>
										</div>
										<p className="font-mono text-xl">Pot: {gameState.pot}</p>
									</>
								) : (
									<p className="text-muted-foreground">
										Waiting for game to start...
									</p>
								)}
							</div>

							{gameState && (
								<div className="my-4">
									<HandHistory
										history={gameState.handHistory}
										currentPhase={gameState.phase}
									/>
								</div>
							)}

							<div className="mt-auto border-t pt-4">
								<div className="flex flex-wrap items-center justify-center gap-2">
									{canStartGame && (
										<Tooltip>
											<TooltipTrigger asChild>
												<span
													tabIndex={
														!canStartGame || startGame.isPending ? 0 : -1
													}
													className={!canStartGame ? "cursor-not-allowed" : ""}
												>
													<Button
														variant="default"
														size="sm"
														onClick={() => {
															if (canStartGame) startGame.mutate(roomId);
														}}
														disabled={!canStartGame || startGame.isPending}
														aria-disabled={!canStartGame || startGame.isPending}
														className={
															!canStartGame
																? "pointer-events-none opacity-50"
																: ""
														}
													>
														{startGame.isPending ? "Starting..." : "Start Game"}
													</Button>
												</span>
											</TooltipTrigger>
											{!canStartGame && !startGame.isPending && (
												<TooltipContent>
													<p>{startGameButtonTitle}</p>
												</TooltipContent>
											)}
										</Tooltip>
									)}
									{showPlayButton && (
										<Button
											variant={wantsToPlay ? "secondary" : "outline"}
											size="sm"
											onClick={() =>
												togglePlay.mutate({ roomId, wantsToPlay: !wantsToPlay })
											}
											disabled={togglePlay.isPending || !isConnected}
										>
											{togglePlay.isPending ? "..." : playButtonText}
										</Button>
									)}
									{isMyTurn && currentPlayerState && (
										<>
											<Button
												variant="destructive"
												size="sm"
												onClick={handleFold}
											>
												Fold
											</Button>
											{canCheck && (
												<Button
													variant="outline"
													size="sm"
													onClick={handleCheck}
												>
													Check
												</Button>
											)}
											{canCall && (
												<Button
													variant="outline"
													size="sm"
													onClick={handleCall}
												>
													Call {callAmount}
												</Button>
											)}
											{(canBet || canRaise) && (
												<div className="flex flex-wrap items-center justify-center gap-1">
													<Input
														type="number"
														value={betAmount === 0 ? "" : betAmount}
														onChange={(e) =>
															setBetAmount(
																e.target.value === ""
																	? 0
																	: Number.parseInt(e.target.value, 10) || 0,
															)
														}
														min={canBet ? minBetValue : minRaiseToValue}
														max={maxBetOrRaiseValue}
														step={room.bigBlind > 0 ? room.bigBlind : 1}
														className="h-8 w-24 rounded border bg-background px-2 text-sm"
														placeholder={
															canBet
																? `Min ${minBetValue}`
																: `Min ${minRaiseToValue}`
														}
														aria-label="Bet or Raise Amount"
													/>
													{canBet && (
														<Button
															size="sm"
															onClick={handleBet}
															disabled={
																betAmount < minBetValue ||
																betAmount > maxBetOrRaiseValue
															}
														>
															Bet {betAmount > 0 ? betAmount : ""}
														</Button>
													)}
													{canRaise && (
														<Tooltip>
															<TooltipTrigger asChild>
																<span
																	tabIndex={
																		betAmount < minRaiseToValue ||
																		betAmount > maxBetOrRaiseValue
																			? 0
																			: -1
																	}
																>
																	<Button
																		size="sm"
																		onClick={handleRaise}
																		disabled={
																			betAmount < minRaiseToValue ||
																			betAmount > maxBetOrRaiseValue
																		}
																	>
																		Raise to {betAmount > 0 ? betAmount : ""}
																	</Button>
																</span>
															</TooltipTrigger>
															{(betAmount < minRaiseToValue ||
																betAmount > maxBetOrRaiseValue) && (
																<TooltipContent>
																	<p>
																		Raise must be between {minRaiseToValue} and{" "}
																		{maxBetOrRaiseValue}.
																	</p>
																</TooltipContent>
															)}
														</Tooltip>
													)}
												</div>
											)}
											{(canBet || canRaise || canCall) && playerStack > 0 && (
												<Button
													variant="secondary"
													size="sm"
													onClick={() => {
														const allInAmount = playerStack + playerCurrentBet;
														if (canBet && allInAmount > 0)
															sendMessage({
																type: "action",
																action: "bet",
																amount: allInAmount,
															});
														else if (canRaise && allInAmount > currentBet)
															sendMessage({
																type: "action",
																action: "raise",
																amount: allInAmount,
															});
														else if (canCall) handleCall();
													}}
												>
													All In ({playerStack})
												</Button>
											)}
										</>
									)}
								</div>
								{gameState?.currentPlayerSeat !== null &&
									!isMyTurn &&
									gameState?.phase !== "waiting" &&
									gameState?.phase !== "end_hand" && (
										<p className="mt-4 text-center text-muted-foreground text-sm">
											Waiting for Seat {gameState?.currentPlayerSeat}...
										</p>
									)}
								{gameState?.phase === "end_hand" && (
									<p className="mt-4 text-center font-semibold text-sm">
										Hand finished. Waiting for next hand...
									</p>
								)}
							</div>
						</div>
					</div>
					<RoomChat
						messages={chatMessages}
						sendMessage={sendChatMessage}
						isConnected={isConnected}
						currentUserId={session.user.id}
						filterProfanity={room.filterProfanity}
						isAdmin={isAdmin}
						onToggleFilter={
							isAdmin
								? (enabled) =>
										updateFilter.mutate({ roomId, filterProfanity: enabled })
								: undefined
						}
						isUpdatingFilter={updateFilter.isPending}
					/>
				</div>
			</div>
		</TooltipProvider>
	);
}
