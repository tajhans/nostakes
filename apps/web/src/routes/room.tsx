import Loader from "@/components/loader";
import { RoomChat } from "@/components/room-chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { trpcClient } from "@/utils/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Circle, CircleDot, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type Suit = "C" | "D" | "H" | "S";
type Rank =
	| "2"
	| "3"
	| "4"
	| "5"
	| "6"
	| "7"
	| "8"
	| "9"
	| "T"
	| "J"
	| "Q"
	| "K"
	| "A";

interface Card {
	rank: Rank;
	suit: Suit;
}

type GamePhase =
	| "waiting"
	| "preflop"
	| "flop"
	| "turn"
	| "river"
	| "showdown"
	| "end_hand";

interface PlayerState {
	userId: string;
	seatNumber: number;
	stack: number;
	hand: Card[];
	currentBet: number;
	totalBet: number;
	hasActed: boolean;
	isFolded: boolean;
	isAllIn: boolean;
	isSittingOut: boolean;
}

interface GameState {
	roomId: string;
	phase: GamePhase;
	communityCards: Card[];
	pot: number;
	currentBet: number;
	minRaiseAmount: number;
	dealerSeat: number;
	smallBlindSeat: number;
	bigBlindSeat: number;
	currentPlayerSeat: number | null;
	lastActionPlayerSeat: number | null;
	playerStates: Record<string, PlayerState>;
	handHistory: string[];
	lastUpdateTime: number;
	roomConfig: { smallBlind: number; bigBlind: number; ante: number };
}

type ClientGameState = Omit<GameState, "deck">;

interface ChatMessage {
	type: "chat";
	id: string;
	roomId: string;
	userId: string;
	username: string;
	message: string;
	timestamp: number;
}

interface ClientChatMessage {
	type: "chat";
	message: string;
}

interface MessageHistory {
	type: "history";
	messages: ChatMessage[];
}

interface RoomMemberInfo {
	userId: string;
	username: string;
	seatNumber: number;
	currentStack: number;
	isActive: boolean;
	wantsToPlayNextHand?: boolean;
	id?: string;
	image?: string | null;
	joinedAt?: Date;
}

interface RoomStateUpdate {
	type: "room_state";
	members: RoomMemberInfo[];
}

interface RoomClosed {
	type: "room_closed";
}

interface GameStateUpdate {
	type: "game_state";
	gameState: ClientGameState;
}

type ClientPokerAction =
	| { type: "action"; action: "fold" }
	| { type: "action"; action: "check" }
	| { type: "action"; action: "call" }
	| { type: "action"; action: "bet"; amount: number }
	| { type: "action"; action: "raise"; amount: number };

interface ErrorMessage {
	type: "error";
	message: string;
}

type ServerWebSocketMessage =
	| ChatMessage
	| MessageHistory
	| RoomStateUpdate
	| RoomClosed
	| GameStateUpdate
	| ErrorMessage;

interface RoomData {
	id: string;
	createdAt: string;
	startingStack: number;
	smallBlind: number;
	bigBlind: number;
	ante: number;
	joinCode: string;
	maxPlayers: number;
	isActive: boolean;
	ownerId: string;
	members: RoomMemberInfo[];
}

interface CardComponentProps {
	rank: Rank;
	suit: Suit;
	size?: "sm" | "md" | "lg";
}

const CardComponent: React.FC<CardComponentProps> = ({
	rank,
	suit,
	size = "md",
}) => {
	const cardCode = `${rank}${suit}`;
	const imageUrl = `https://image.nostakes.poker/cards/${cardCode}.svg`;

	const sizeClasses = {
		sm: "h-8 w-auto",
		md: "h-12 w-auto",
		lg: "h-28 w-auto",
	};

	const suitNameMap: Record<Suit, string> = {
		C: "Clubs",
		D: "Diamonds",
		H: "Hearts",
		S: "Spades",
	};

	const rankNameMap: Record<Rank, string> = {
		"2": "2",
		"3": "3",
		"4": "4",
		"5": "5",
		"6": "6",
		"7": "7",
		"8": "8",
		"9": "9",
		T: "10",
		J: "Jack",
		Q: "Queen",
		K: "King",
		A: "Ace",
	};

	const altText = `${rankNameMap[rank]} of ${suitNameMap[suit]}`;

	return (
		<img
			src={imageUrl}
			alt={altText}
			className={`inline-block select-none ${sizeClasses[size]}`}
			loading="eager"
			draggable="false"
		/>
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
	const [gameState, setGameState] = useState<ClientGameState | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const [betAmount, setBetAmount] = useState<number>(0);
	const [isCopied, setIsCopied] = useState(false);

	const { data: initialRoomData, isLoading: isRoomLoading } = useQuery({
		...trpc.getRooms.queryOptions(),
		enabled: !!session && !!roomId,
		select: (data): RoomData | undefined => data.find((r) => r.id === roomId),
		staleTime: 5 * 60 * 1000,
		gcTime: 10 * 60 * 1000,
	});

	const startGame = useMutation({
		mutationFn: async (rId: string) => {
			return trpcClient.startGame.mutate({ roomId: rId });
		},
		onSuccess: () => {
			toast.success("Game started!");
			queryClient.invalidateQueries({ queryKey: trpc.getRooms.queryKey() });
		},
		onError: (error) => {
			toast.error(`Failed to start game: ${error.message}`);
		},
	});

	const closeRoom = useMutation({
		mutationFn: async (rId: string) => {
			return trpcClient.closeRoom.mutate({ roomId: rId });
		},
		onSuccess: () => {
			toast.success("Room closed successfully");
		},
		onError: (error) => {
			toast.error(`Failed to close room: ${error.message}`);
		},
	});

	const leaveRoom = useMutation({
		mutationFn: async (rId: string) => {
			return trpcClient.leaveRoom.mutate({ roomId: rId });
		},
		onSuccess: () => {
			toast.success("You have left the room.");
			navigate({ to: "/" });
		},
		onError: (error) => {
			toast.error(`Failed to leave room: ${error.message}`);
		},
	});

	const togglePlay = useMutation({
		mutationFn: async (variables: { roomId: string; wantsToPlay: boolean }) => {
			return trpcClient.togglePlayStatus.mutate(variables);
		},
		onSuccess: (_, variables) => {
			const actionText = variables.wantsToPlay ? "IN" : "OUT";
			const typeText = (initialRoomData?.ante ?? 0) > 0 ? "ante" : "hand";
			toast.success(`You are now ${actionText} for the next ${typeText}.`);
		},
		onError: (error) => {
			toast.error(`Failed to update status: ${error.message}`);
		},
	});

	useEffect(() => {
		if (
			isSessionPending ||
			!roomId ||
			isRoomLoading ||
			(initialRoomData === undefined && !isRoomLoading)
		) {
			console.log(
				"WebSocket Effect: Prerequisites not met (session pending, no roomId, room loading, or room not found).",
			);
			if (wsRef.current) {
				console.log(
					"WebSocket Effect: Closing existing connection due to unmet prerequisites.",
				);
				wsRef.current.close(1000, "Prerequisites not met");
				wsRef.current = null;
				setIsConnected(false);
			}
			return;
		}

		if (!initialRoomData) {
			console.log("WebSocket Effect: Room data not found, not connecting.");
			return;
		}

		if (!session?.user) {
			console.log(
				"WebSocket Effect: User session not available, not connecting.",
			);
			return;
		}

		const serverUrlString = import.meta.env.VITE_SERVER_URL;
		if (!serverUrlString) {
			console.error(
				"VITE_SERVER_URL is not defined in environment variables. Cannot establish WebSocket connection.",
			);
			toast.error("Server configuration error. Unable to connect to the room.");
			if (wsRef.current) {
				wsRef.current.close(1000, "Configuration error");
				wsRef.current = null;
				setIsConnected(false);
			}
			return;
		}

		if (wsRef.current) {
			console.log(
				"WebSocket Effect: Closing previous connection before creating new one.",
			);
			wsRef.current.close(1000, "Reconnecting or dependencies changed");
			wsRef.current = null;
		}

		const serverUrl = new URL(serverUrlString);
		const wsProtocol = serverUrl.protocol === "https:" ? "wss" : "ws";
		const wsUrl = `${wsProtocol}://${serverUrl.host}/ws?roomId=${roomId}&userId=${session.user.id}&username=${encodeURIComponent(session.user.username || "Anonymous")}`;

		console.log("WebSocket Effect: Attempting to connect to", wsUrl);
		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		const handleOpen = () => {
			console.log("WebSocket connected");
			if (wsRef.current === ws) {
				setIsConnected(true);
				toast.success("Connected to room server.");
			}
		};

		const handleMessage = (event: MessageEvent) => {
			if (wsRef.current !== ws) return;

			try {
				const data: ServerWebSocketMessage = JSON.parse(event.data);
				console.log("WS Message Received:", data);

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
						const processedMembers: RoomMemberInfo[] = data.members.map(
							(member) => ({
								...member,
								joinedAt: member.joinedAt
									? new Date(member.joinedAt)
									: undefined,
							}),
						);
						setMembers(processedMembers);
						queryClient.setQueryData<RoomData[] | undefined>(
							trpc.getRooms.queryKey(),
							(oldData): RoomData[] | undefined => {
								if (!oldData) return undefined;
								return oldData.map((r) =>
									r.id === roomId ? { ...r, members: processedMembers } : r,
								);
							},
						);
						break;
					}
					case "room_closed":
						toast.info("The room has been closed by the owner.");
						if (wsRef.current === ws) {
							wsRef.current.close(1000, "Room closed by owner");
						}
						navigate({ to: "/" });
						break;
					case "game_state":
						console.log("Game State Update Received:", data.gameState);
						setGameState(data.gameState);
						if (
							data.gameState.phase !== gameState?.phase ||
							data.gameState.currentPlayerSeat !== gameState?.currentPlayerSeat
						) {
							setBetAmount(0);
						}
						break;
					case "error":
						toast.error(`Server error: ${data.message}`);
						break;
					default:
						console.warn("Received unknown WebSocket message type:", data);
				}
			} catch (error) {
				console.error("Failed to parse WebSocket message:", error);
				toast.error("Received invalid data from server.");
			}
		};

		const handleClose = (event: CloseEvent) => {
			console.log("WebSocket disconnected", event.code, event.reason);
			if (wsRef.current === ws) {
				setIsConnected(false);
				wsRef.current = null;

				const expectedReasons = [
					"Room closed by owner",
					"Client navigating away",
					"Reconnecting or dependencies changed",
					"Prerequisites not met",
					"New connection established",
				];
				if (
					event.code !== 1000 &&
					event.code !== 1001 &&
					event.code !== 1005 &&
					!expectedReasons.includes(event.reason)
				) {
					toast.error(
						`Connection lost unexpectedly (Code: ${event.code}). Attempting to reconnect...`,
					);
				} else if (event.reason && !expectedReasons.includes(event.reason)) {
					toast.info(`Disconnected: ${event.reason}`);
				} else if (event.code !== 1000) {
					toast.info(`Disconnected (Code: ${event.code})`);
				}
			} else {
				console.log(
					"WebSocket closed, but ref points to a different instance or null.",
				);
			}
		};

		const handleError = (error: Event) => {
			console.error("WebSocket error:", error);
			if (wsRef.current === ws) {
				toast.error("WebSocket connection error.");
			}
		};

		ws.onopen = handleOpen;
		ws.onmessage = handleMessage;
		ws.onclose = handleClose;
		ws.onerror = handleError;

		return () => {
			console.log("WebSocket Effect: Cleanup function running...");
			if (ws && ws.readyState < WebSocket.CLOSING) {
				console.log(
					"WebSocket Effect: Closing connection via cleanup function.",
				);
				ws.close(1000, "Client navigating away");
			}
			if (wsRef.current === ws) {
				console.log(
					"WebSocket Effect: Clearing ref in cleanup as it matched closing ws.",
				);
				wsRef.current = null;
				setIsConnected(false);
			}
		};
	}, [
		roomId,
		session,
		initialRoomData,
		navigate,
		queryClient,
		isSessionPending,
		isRoomLoading,
		gameState?.currentPlayerSeat,
		gameState?.phase,
	]);

	useEffect(() => {
		if (initialRoomData?.members) {
			const processedInitialMembers = initialRoomData.members.map((member) => ({
				...member,
				joinedAt: member.joinedAt ? new Date(member.joinedAt) : undefined,
			}));
			setMembers(processedInitialMembers as RoomMemberInfo[]);
		}
	}, [initialRoomData]);

	useEffect(() => {
		const currentPlayerState = gameState?.playerStates[session?.user?.id ?? ""];
		const isMyTurn =
			!!currentPlayerState &&
			gameState?.currentPlayerSeat === currentPlayerState?.seatNumber &&
			!currentPlayerState?.isFolded &&
			!currentPlayerState?.isAllIn &&
			!currentPlayerState?.isSittingOut;

		if (!isMyTurn || !gameState || !initialRoomData || !currentPlayerState) {
			return;
		}

		const currentBet = gameState.currentBet;
		const minRaiseAmount = gameState.minRaiseAmount;
		const playerCurrentBet = currentPlayerState.currentBet;
		const playerStack = currentPlayerState.stack;

		const canBet = currentBet === 0 && playerStack > 0;
		const canRaise =
			currentBet > 0 && playerStack > currentBet - playerCurrentBet;

		const minBet = Math.min(initialRoomData.bigBlind, playerStack);
		const minRaiseTo = Math.min(
			currentBet + minRaiseAmount,
			playerStack + playerCurrentBet,
		);
		const maxBetOrRaise = playerStack + playerCurrentBet;

		let adjustedBetAmount = betAmount;
		let adjustmentNeeded = false;

		if (canBet && betAmount > 0 && betAmount < minBet) {
			if (betAmount !== playerStack) {
				adjustedBetAmount = minBet;
				adjustmentNeeded = true;
			}
		} else if (canRaise && betAmount > currentBet && betAmount < minRaiseTo) {
			if (betAmount !== maxBetOrRaise) {
				adjustedBetAmount = minRaiseTo;
				adjustmentNeeded = true;
			}
		}

		if ((canBet || canRaise) && betAmount > maxBetOrRaise) {
			adjustedBetAmount = maxBetOrRaise;
			adjustmentNeeded = true;
		}

		if (adjustmentNeeded) {
			console.log(
				`Adjusting bet amount from ${betAmount} to ${adjustedBetAmount}`,
			);
			setBetAmount(adjustedBetAmount);
		}
	}, [gameState, session?.user?.id, initialRoomData, betAmount]);

	const sendMessage = (message: ClientChatMessage | ClientPokerAction) => {
		if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
			console.log("Sending WS Message:", message);
			wsRef.current.send(JSON.stringify(message));
		} else {
			console.warn("Attempted to send message, but WebSocket is not open.");
			toast.error("Cannot send message. Connection not active.");
		}
	};

	const sendChatMessage = (messageText: string) => {
		if (messageText.trim()) {
			sendMessage({ type: "chat", message: messageText.trim() });
		}
	};

	const handleCopyCode = async () => {
		if (!initialRoomData?.joinCode) return;
		const codeToCopy = initialRoomData.joinCode;

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

	const handleFold = () => sendMessage({ type: "action", action: "fold" });
	const handleCheck = () => sendMessage({ type: "action", action: "check" });
	const handleCall = () => sendMessage({ type: "action", action: "call" });
	const handleBet = () => {
		const amount = Math.floor(betAmount);
		if (amount > 0) {
			sendMessage({ type: "action", action: "bet", amount: amount });
		} else {
			toast.error("Invalid bet amount");
		}
	};
	const handleRaise = () => {
		const amount = Math.floor(betAmount);
		if (amount > (gameState?.currentBet ?? 0)) {
			sendMessage({ type: "action", action: "raise", amount: amount });
		} else {
			toast.error("Invalid raise amount");
		}
	};

	if (isSessionPending || (roomId && isRoomLoading)) {
		return <Loader />;
	}

	if (!session?.user) {
		return <Loader />;
	}

	if (roomId && !isRoomLoading && !initialRoomData) {
		return (
			<div className="container mx-auto px-4 py-8 text-center">
				<h1 className="mb-4 font-bold text-xl">Room Not Found</h1>
				<p className="text-muted-foreground">
					The room you are looking for does not exist or you may not have access
					to it.
				</p>
				<Button onClick={() => navigate({ to: "/" })} className="mt-4">
					Go to Home
				</Button>
			</div>
		);
	}

	if (!initialRoomData) {
		console.error("Error: initialRoomData is unexpectedly null/undefined.");
		return (
			<div className="container mx-auto px-4 py-8 text-center">
				<h1 className="mb-4 font-bold text-destructive text-xl">
					Error Loading Room Data
				</h1>
				<Button onClick={() => navigate({ to: "/" })} className="mt-4">
					Go to Home
				</Button>
			</div>
		);
	}

	const room = initialRoomData;
	const activeMembers = members.filter((m) => m.isActive);
	const isAdmin = session.user.id === room.ownerId;
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
	const minBet = Math.max(1, Math.min(room.bigBlind, playerStack));
	const minRaiseTo = Math.min(
		currentBet + minRaiseAmount,
		playerStack + playerCurrentBet,
	);
	const maxBetOrRaise = playerStack + playerCurrentBet;

	return (
		<TooltipProvider>
			<div className="container mx-auto max-w-5xl px-4 py-2">
				<div className="grid gap-4 lg:grid-cols-[1fr_400px]">
					<div className="space-y-4">
						<div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
							<div className="flex items-center gap-2">
								<span className="font-medium text-sm">Join Code:</span>
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
											<Circle className="h-4 w-4 text-red-600" />
										)}
									</TooltipTrigger>
									<TooltipContent>
										<p>
											{isConnected
												? "Connected to room server"
												: "Disconnected from room server"}
										</p>
									</TooltipContent>
								</Tooltip>
							</div>

							<div className="flex flex-wrap items-center justify-end gap-2">
								{showPlayButton && currentUserMemberInfo?.isActive && (
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
								{isAdmin && room.isActive && (
									<Button
										variant="destructive"
										size="sm"
										onClick={() => {
											if (
												window.confirm(
													"Are you sure you want to close this room? All players will be removed.",
												)
											) {
												closeRoom.mutate(roomId);
											}
										}}
										disabled={closeRoom.isPending || !isConnected}
									>
										{closeRoom.isPending ? "Closing..." : "Close Room"}
									</Button>
								)}
								{isAdmin &&
									room.isActive &&
									(!gameState ||
										gameState.phase === "waiting" ||
										gameState.phase === "end_hand") && (
										<Button
											variant="default"
											size="sm"
											onClick={() => startGame.mutate(roomId)}
											disabled={
												startGame.isPending ||
												!isConnected ||
												activeMembers.filter((m) => m.wantsToPlayNextHand)
													.length < 2
											}
											title={
												activeMembers.filter((m) => m.wantsToPlayNextHand)
													.length < 2
													? "Need at least 2 players ready for the next hand"
													: "Start the next hand"
											}
										>
											{startGame.isPending ? "Starting..." : "Start Game"}
										</Button>
									)}
								{!isAdmin && currentUserMemberInfo?.isActive && (
									<Button
										variant="outline"
										size="sm"
										onClick={() => {
											if (
												window.confirm(
													"Are you sure you want to leave this room?",
												)
											) {
												leaveRoom.mutate(roomId);
											}
										}}
										disabled={leaveRoom.isPending || !isConnected}
									>
										{leaveRoom.isPending ? "Leaving..." : "Leave Room"}
									</Button>
								)}
							</div>
						</div>

						<div className="rounded-lg border p-4">
							<h2 className="mb-2 font-medium">Room Info</h2>
							<div className="grid grid-cols-1 gap-x-4 gap-y-1 text-muted-foreground text-sm sm:grid-cols-2">
								<p>
									Players: {activeMembers.length}/{room.maxPlayers}
								</p>
								<p>Starting Stack: {room.startingStack}</p>
								<p>Small Blind: {room.smallBlind}</p>
								<p>Big Blind: {room.bigBlind}</p>
								<p>Ante: {room.ante}</p>
								<p>Status: {room.isActive ? "Open" : "Closed"}</p>
							</div>
						</div>

						<div className="rounded-lg border p-4">
							<h2 className="mb-2 font-medium">Players</h2>
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
													className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded p-2 transition-all ${member.isActive ? "bg-accent/50" : "bg-muted/30 opacity-60"} ${isCurrent ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
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
															playerState?.hand &&
															playerState.hand.length > 0 &&
															!playerState.isFolded && (
																<div className="ml-1 flex items-center gap-1">
																	{playerState.hand.map((c, index) => (
																		<CardComponent
																			key={`${c.rank}${c.suit}-${index}`}
																			rank={c.rank}
																			suit={c.suit}
																			size="lg"
																		/>
																	))}
																</div>
															)}
														{(playerState?.currentBet ?? 0) > 0 && (
															<span className="rounded bg-primary/20 px-1.5 py-0.5 font-mono text-xs">
																Bet: {playerState?.currentBet}
															</span>
														)}
													</div>
													<span className="font-mono text-sm">
														{displayStack}
													</span>
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

						<div className="flex min-h-[300px] flex-col items-center justify-center rounded-lg border p-4">
							<h2 className="mb-4 font-medium">
								Game Phase:{" "}
								<span className="font-semibold">
									{gameState?.phase?.replace(/_/g, " ").toUpperCase() ??
										"WAITING"}
								</span>
							</h2>
							{gameState ? (
								<div className="w-full space-y-4 text-center">
									<div className="mb-4">
										<h3 className="mb-1 font-medium text-sm">
											Community Cards
										</h3>
										<div className="flex min-h-[36px] flex-wrap items-center justify-center gap-2 font-mono text-lg">
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
													--
												</span>
											)}
										</div>
									</div>

									<p className="font-mono text-xl">Pot: {gameState.pot}</p>

									<div className="max-h-24 overflow-y-auto rounded border bg-muted/50 p-2 text-muted-foreground text-xs">
										{gameState.handHistory.length > 0 ? (
											gameState.handHistory
												.slice(-5)
												.map((line, i) => <p key={i}>{line}</p>)
										) : (
											<p>No actions yet this hand.</p>
										)}
									</div>

									{isMyTurn && currentPlayerState && (
										<div className="mt-4 flex flex-wrap items-center justify-center gap-2 border-t pt-4">
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
														onChange={(e) => {
															const val = e.target.value;
															setBetAmount(
																val === "" ? 0 : Number.parseInt(val, 10) || 0,
															);
														}}
														min={canBet ? minBet : minRaiseTo}
														max={maxBetOrRaise}
														step={room.bigBlind > 0 ? room.bigBlind : 1}
														className="h-8 w-24 rounded border bg-background px-2 text-sm"
														placeholder={
															canBet ? `Min ${minBet}` : `Min ${minRaiseTo}`
														}
													/>
													{canBet && (
														<Button
															size="sm"
															onClick={handleBet}
															disabled={
																betAmount < minBet || betAmount > maxBetOrRaise
															}
														>
															Bet {betAmount > 0 ? betAmount : ""}
														</Button>
													)}
													{canRaise && (
														<Button
															size="sm"
															onClick={handleRaise}
															disabled={
																betAmount < minRaiseTo ||
																betAmount > maxBetOrRaise
															}
														>
															Raise to {betAmount > 0 ? betAmount : ""}
														</Button>
													)}
												</div>
											)}

											{(canBet || canRaise || canCall) && playerStack > 0 && (
												<Button
													variant="secondary"
													size="sm"
													onClick={() => {
														const allInAmount = playerStack + playerCurrentBet;
														if (
															canBet ||
															(canRaise && allInAmount > currentBet)
														) {
															const actionType = canBet ? "bet" : "raise";
															sendMessage({
																type: "action",
																action: actionType,
																amount: allInAmount,
															});
														} else if (canCall) {
															handleCall();
														}
													}}
												>
													All In ({playerStack})
												</Button>
											)}
										</div>
									)}

									{gameState.currentPlayerSeat !== null &&
										!isMyTurn &&
										gameState.phase !== "waiting" &&
										gameState.phase !== "end_hand" && (
											<p className="mt-4 text-muted-foreground text-sm">
												Waiting for Seat {gameState.currentPlayerSeat}...
											</p>
										)}

									{gameState.phase === "end_hand" && (
										<p className="mt-4 font-semibold text-sm">
											Hand finished. Waiting for next hand...
										</p>
									)}
								</div>
							) : (
								<p className="text-muted-foreground">
									Waiting for game to start...
								</p>
							)}
						</div>
					</div>

					<RoomChat
						messages={chatMessages}
						sendMessage={sendChatMessage}
						isConnected={isConnected}
						currentUserId={session.user.id}
					/>
				</div>
			</div>
		</TooltipProvider>
	);
}
