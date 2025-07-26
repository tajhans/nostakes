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
import { UserCheck, UserPlus, UserX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type {
	Card,
	CardComponentProps,
	ChatMessage,
	ClientChatMessage,
	ClientPokerAction,
	GameState,
	HandEvaluationResult,
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
		md: "h-24 w-[4.5rem] text-lg",
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
		select: (data): RoomData | undefined =>
			data.find((r: RoomData) => r.id === roomId),
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

	const { data: friends = [] } = useQuery({
		...trpc.getFriends.queryOptions(),
		enabled: !!session?.user?.id,
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

	const sendFriendRequest = useMutation({
		mutationFn: async (friendId: string) =>
			trpcClient.sendFriendRequest.mutate({ friendId }),
		onSuccess: (_, friendId) => {
			const member = members.find((m) => m.userId === friendId);
			toast.success(`Friend request sent to ${member?.username || "user"}!`);
		},
		onError: (error) => {
			toast.error(`Failed to send friend request: ${error.message}`);
		},
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
			return evaluateHand(
				loggedInUserHoleCards,
				communityCards,
			) as HandEvaluationResult;
		}
		return null;
	}, [loggedInUserHoleCards, communityCards]);

	const handleFriendRequest = (userId: string) => {
		sendFriendRequest.mutate(userId);
	};

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
										(patch) => patch.path === "/currentPlayerSeat",
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

	const room: RoomData = initialRoomData;
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
										.map((member: RoomMemberInfo) => {
											const isFriend = (friends as string[]).includes(
												member.userId,
											);
											const isCurrentUser = member.userId === session.user.id;
											const gamePlayer = gameState?.playerStates[member.userId];
											const isCurrentTurn =
												gameState?.currentPlayerSeat === member.seatNumber;

											return (
												<div
													key={member.userId}
													className={cn(
														"flex items-center justify-between rounded-lg border p-3",
														!member.isActive && "opacity-50",
														isCurrentTurn && "ring-2 ring-primary",
													)}
												>
													<div className="flex items-center gap-3">
														<div className="flex items-center gap-2">
															<span
																className={cn(
																	"flex h-6 w-6 items-center justify-center rounded-full font-bold text-xs",
																	{
																		"bg-primary text-primary-foreground":
																			isCurrentTurn,
																		"bg-muted text-muted-foreground":
																			!isCurrentTurn,
																	},
																)}
															>
																#{member.seatNumber}
															</span>
															<span className="font-medium">
																{member.username}
																{member.userId === session.user.id && " (You)"}
															</span>
															{member.userId === room.ownerId && (
																<span className="rounded bg-primary px-1.5 py-0.5 text-primary-foreground text-xs">
																	Admin
																</span>
															)}
															{gamePlayer?.isSittingOut && (
																<span className="rounded bg-yellow-600 px-1.5 py-0.5 text-white text-xs">
																	Sitting Out
																</span>
															)}
														</div>
													</div>

													<div className="flex items-center gap-2">
														<div className="text-right text-sm">
															<div className="font-medium">
																{member.currentStack} chips
															</div>
															{gameState && (
																<div className="text-muted-foreground text-xs">
																	Bet: {gamePlayer?.currentBet ?? 0}
																</div>
															)}
														</div>

														<div className="flex gap-1">
															{!isCurrentUser && (
																<Tooltip>
																	<TooltipTrigger asChild>
																		<Button
																			size="icon"
																			variant="ghost"
																			className="h-8 w-8"
																			onClick={() =>
																				handleFriendRequest(member.userId)
																			}
																			disabled={
																				isFriend || sendFriendRequest.isPending
																			}
																		>
																			{isFriend ? (
																				<UserCheck className="h-4 w-4" />
																			) : (
																				<UserPlus className="h-4 w-4" />
																			)}
																		</Button>
																	</TooltipTrigger>
																	<TooltipContent>
																		{isFriend
																			? "Already friends"
																			: `Send friend request to ${member.username}`}
																	</TooltipContent>
																</Tooltip>
															)}

															{isAdmin && !isCurrentUser && (
																<Dialog
																	open={userToKick?.userId === member.userId}
																	onOpenChange={(isOpen) => {
																		if (!isOpen) setUserToKick(null);
																	}}
																>
																	<Tooltip>
																		<TooltipTrigger asChild>
																			<DialogTrigger asChild>
																				<Button
																					size="icon"
																					variant="ghost"
																					className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
																					onClick={() => setUserToKick(member)}
																				>
																					<UserX className="h-4 w-4" />
																				</Button>
																			</DialogTrigger>
																		</TooltipTrigger>
																		<TooltipContent>
																			<p>Kick {member.username}</p>
																		</TooltipContent>
																	</Tooltip>
																	<DialogContent>
																		<DialogHeader>
																			<DialogTitle>
																				Kick {userToKick?.username}?
																			</DialogTitle>
																			<DialogDescription>
																				Are you sure you want to kick this
																				player? They will be removed from the
																				room.
																			</DialogDescription>
																		</DialogHeader>
																		<DialogFooter>
																			<DialogClose asChild>
																				<Button variant="outline">
																					Cancel
																				</Button>
																			</DialogClose>
																			<Button
																				variant="destructive"
																				onClick={() =>
																					userToKick &&
																					kickUser.mutate({
																						roomId,
																						userIdToKick: userToKick.userId,
																					})
																				}
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
											"WAITING FOR PLAYERS"}
									</span>
								</h2>
								{gameState ? (
									<>
										<div className="mb-4">
											<p className="text-muted-foreground text-sm">
												Pot: {gameState.pot} | Current Bet:{" "}
												{gameState.currentBet}
											</p>
										</div>
										<div className="flex flex-wrap justify-center gap-2">
											{gameState.communityCards.map((card, idx) => (
												<CardComponent
													key={idx}
													rank={card.rank}
													suit={card.suit}
													size="lg"
												/>
											))}
										</div>
										{loggedInUserHoleCards &&
											loggedInUserHoleCards.length > 0 && (
												<div className="mt-4">
													<p className="mb-2 font-medium text-sm">
														Your Cards:
													</p>
													<div className="flex justify-center gap-2">
														{loggedInUserHoleCards.map((card, idx) => (
															<CardComponent
																key={idx}
																rank={card.rank}
																suit={card.suit}
																size="md"
															/>
														))}
													</div>
													{bestHandDisplayData?.bestFive && (
														<div className="mt-2">
															<p className="font-medium text-sm">
																Best Hand: {bestHandDisplayData.handName}
															</p>
															<div className="mt-1 flex justify-center gap-1">
																{bestHandDisplayData.bestFive.map(
																	(card: Card, idx: number) => (
																		<CardComponent
																			key={idx}
																			rank={card.rank}
																			suit={card.suit}
																			size="sm"
																		/>
																	),
																)}
															</div>
														</div>
													)}
												</div>
											)}
									</>
								) : (
									<p className="text-muted-foreground">
										Game will start when the admin is ready.
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
												<Button
													onClick={() => startGame.mutate(roomId)}
													disabled={startGame.isPending}
													className="bg-green-600 hover:bg-green-700"
												>
													{startGame.isPending ? "Starting..." : "Start Game"}
												</Button>
											</TooltipTrigger>
											<TooltipContent>{startGameButtonTitle}</TooltipContent>
										</Tooltip>
									)}

									{showPlayButton && (
										<Button
											onClick={() =>
												togglePlay.mutate({
													roomId,
													wantsToPlay: !wantsToPlay,
												})
											}
											disabled={togglePlay.isPending}
											variant={wantsToPlay ? "destructive" : "default"}
										>
											{togglePlay.isPending ? "Updating..." : playButtonText}
										</Button>
									)}

									{isMyTurn && (
										<>
											{canCheck && (
												<Button onClick={handleCheck} variant="outline">
													Check
												</Button>
											)}
											{canCall && (
												<Button onClick={handleCall} variant="outline">
													Call {callAmount}
												</Button>
											)}
											<Button onClick={handleFold} variant="destructive">
												Fold
											</Button>
											<div className="flex items-center gap-2">
												<Input
													type="number"
													value={betAmount}
													onChange={(e) => setBetAmount(Number(e.target.value))}
													min={canBet ? minBetValue : minRaiseToValue}
													max={maxBetOrRaiseValue}
													className="w-24"
												/>
												{canBet && (
													<Button onClick={handleBet} variant="outline">
														Bet
													</Button>
												)}
												{canRaise && (
													<Button onClick={handleRaise} variant="outline">
														Raise
													</Button>
												)}
											</div>
										</>
									)}
								</div>
								{gameState?.currentPlayerSeat !== null &&
									!isMyTurn &&
									gameState?.phase !== "waiting" &&
									gameState?.phase !== "end_hand" && (
										<p className="mt-4 text-center text-muted-foreground text-sm">
											Waiting for other players...
										</p>
									)}
								{gameState?.phase === "end_hand" && (
									<p className="mt-4 text-center font-semibold text-sm">
										Hand completed. Waiting for next hand to start.
									</p>
								)}
							</div>
						</div>
					</div>
					<div className="flex h-full flex-col">
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
			</div>
		</TooltipProvider>
	);
}
