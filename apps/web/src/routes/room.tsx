import { HandHistory } from "@/components/hand-history";
import { RoomChat } from "@/components/room-chat";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { UpdateMaxPlayersDialog } from "@/components/update-max-players-dialog";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";
import { trpcClient } from "@/utils/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TRPCClientError } from "@trpc/client";
import { applyPatch } from "fast-json-patch";
import { Check, Circle, CircleDot, Copy, UserX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { suitMap } from "../components/hand-history";

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
	const [isLoaded, setIsLoaded] = useState(false);
	const cardCode = `${rank}${suit}`;
	const imageUrl = `https://image.nostakes.poker/cards/${cardCode}.svg`;

	const sizeClasses = {
		sm: "h-8 w-auto",
		md: "h-12 w-auto",
		lg: "h-28 w-auto",
	};

	const placeholderSizeClasses = {
		sm: "h-8 w-[1.5rem] text-xs",
		md: "h-12 w-[2.25rem] text-sm",
		lg: "h-28 w-[5.25rem] text-lg",
	};

	const suitInfo = suitMap[suit];
	const altText = `${rank} of ${suitInfo.char}`;

	useEffect(() => {
		setIsLoaded(false);
	}, []);

	return (
		<div
			className={cn(
				"inline-flex select-none items-center justify-center",
				sizeClasses[size],
			)}
		>
			{!isLoaded && (
				<div
					className={cn(
						"flex items-center justify-center rounded border bg-card text-card-foreground",
						placeholderSizeClasses[size],
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
			)}
			<img
				src={imageUrl}
				alt={altText}
				className={cn(
					"inline-block select-none",
					sizeClasses[size],
					isLoaded ? "opacity-100" : "absolute opacity-0",
				)}
				loading="eager"
				draggable="false"
				onLoad={() => setIsLoaded(true)}
				onError={() => {
					console.error(`Failed to load card image: ${imageUrl}`);
				}}
			/>
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
	const [isCopied, setIsCopied] = useState(false);
	const hasShownInitialConnectToast = useRef(false);
	const reconnectAttempt = useRef(0);
	const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
	const [userToKick, setUserToKick] = useState<RoomMemberInfo | null>(null);
	const [isCloseRoomDialogOpen, setIsCloseRoomDialogOpen] = useState(false);
	const [isLeaveRoomDialogOpen, setIsLeaveRoomDialogOpen] = useState(false);

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
					console.log(`Not retrying query due to error code: ${code}`);
					return false;
				}
			}

			console.log(
				`Retrying query (attempt ${failureCount + 1}) after error:`,
				error,
			);
			return failureCount < 3;
		},
	});

	const startGame = useMutation({
		mutationFn: async (rId: string) => {
			return trpcClient.startGame.mutate({ roomId: rId });
		},
		onSuccess: () => {
			toast.success("Game started!");
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
			setIsCloseRoomDialogOpen(false);
		},
		onError: (error) => {
			toast.error(`Failed to close room: ${error.message}`);
			setIsCloseRoomDialogOpen(false);
		},
	});

	const leaveRoom = useMutation({
		mutationFn: async (rId: string) => {
			return trpcClient.leaveRoom.mutate({ roomId: rId });
		},
		onSuccess: () => {
			toast.success("You have left the room.");
			setIsLeaveRoomDialogOpen(false);
			navigate({ to: "/" });
		},
		onError: (error) => {
			toast.error(`Failed to leave room: ${error.message}`);
			setIsLeaveRoomDialogOpen(false);
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
			setMembers((prevMembers) =>
				prevMembers.map((m) =>
					m.userId === session?.user?.id
						? { ...m, wantsToPlayNextHand: variables.wantsToPlay }
						: m,
				),
			);
		},
		onError: (error) => {
			toast.error(`Failed to update status: ${error.message}`);
		},
	});

	const kickUser = useMutation({
		mutationFn: async (variables: { roomId: string; userIdToKick: string }) => {
			return trpcClient.kickUser.mutate(variables);
		},
		onSuccess: (data, variables) => {
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
		}) => {
			return trpcClient.updateRoomFilter.mutate(variables);
		},
		onSuccess: (data) => {
			toast.success(data.message);
			queryClient.invalidateQueries({ queryKey: trpc.getRooms.queryKey() });
		},
		onError: (error) => {
			toast.error(`Failed to update filter: ${error.message}`);
		},
	});

	const isHandInProgress =
		!!gameState &&
		gameState.phase !== "waiting" &&
		gameState.phase !== "end_hand";

	useEffect(() => {
		if (reconnectTimeout.current) {
			clearTimeout(reconnectTimeout.current);
			reconnectTimeout.current = null;
		}

		if (isSessionPending) {
			console.log("WebSocket Effect: Waiting for session...");
			return;
		}
		if (!session?.user?.id || !session?.user?.username) {
			console.log("WebSocket Effect: Session data missing (id or username).");
			navigate({ to: "/login" });
			return;
		}
		if (!roomId) {
			console.log("WebSocket Effect: roomId is missing.");
			return;
		}

		if (wsRef.current) {
			console.log(
				"WebSocket Effect: Closing previous connection before creating new one.",
			);
			wsRef.current.close(1000, "Reconnecting or dependencies changed");
			wsRef.current = null;
			setIsConnected(false);
		}

		const serverUrlString = import.meta.env.VITE_SERVER_URL;
		if (!serverUrlString) {
			console.error("VITE_SERVER_URL is not defined.");
			toast.error("Configuration error. Cannot connect.");
			return;
		}

		let wsUrl: string;
		try {
			const serverUrl = new URL(serverUrlString);
			const wsProtocol = serverUrl.protocol === "https:" ? "wss" : "ws";
			wsUrl = `${wsProtocol}://${serverUrl.host}/ws?roomId=${roomId}&userId=${session.user.id}&username=${encodeURIComponent(session.user.username)}`;
		} catch (e) {
			console.error("Invalid VITE_SERVER_URL:", serverUrlString, e);
			toast.error("Invalid server configuration.");
			return;
		}

		console.log("WebSocket Effect: Attempting to connect to", wsUrl);
		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		const handleOpen = () => {
			if (wsRef.current === ws) {
				console.log("WebSocket connected");
				setIsConnected(true);
				reconnectAttempt.current = 0;
				if (!hasShownInitialConnectToast.current) {
					toast.success("Connected to room.");
					hasShownInitialConnectToast.current = true;
				}
			} else {
				console.log(
					"WebSocket opened, but it's not the current ref. Closing it.",
				);
				ws.close(1000, "Stale connection opened");
			}
		};

		const handleMessage = (event: MessageEvent) => {
			if (wsRef.current !== ws) return;

			try {
				const data: ServerWebSocketMessage = JSON.parse(event.data);
				console.debug("WS Message Received:", data.type);

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
						console.log("Room State Update Received", data.members);
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
						if (wsRef.current === ws) {
							wsRef.current.close(1000, "Room closed by owner");
						}
						navigate({ to: "/" });
						break;
					case "game_state":
						console.log("Full Game State Update Received");
						setGameState(data.gameState);
						if (
							data.gameState.phase !== gameState?.phase ||
							data.gameState.currentPlayerSeat !== gameState?.currentPlayerSeat
						) {
							setBetAmount(0);
						}
						break;
					case "game_state_patch":
						console.debug(
							`Game State Patch Received (${data.patches.length} ops)`,
						);
						setGameState((currentState) => {
							if (!currentState) {
								console.warn("Received patches but current state is null.");
								return null;
							}
							try {
								const { newDocument } = applyPatch(
									currentState,
									data.patches,
									true,
									false,
								);
								const phaseChanged = data.patches.some(
									(p) => p.path === "/phase",
								);
								const turnChanged = data.patches.some(
									(p) => p.path === "/currentPlayerSeat",
								);
								if (phaseChanged || turnChanged) {
									setBetAmount(0);
								}
								return newDocument as GameState;
							} catch (error) {
								console.error("Failed to apply game state patches:", error);
								toast.error(
									"Game state update error. State may be out of sync.",
								);
								return currentState;
							}
						});
						break;
					case "user_kicked":
						console.log("Received user_kicked message:", data.reason);
						toast.warning(`You have been kicked: ${data.reason}`);
						if (wsRef.current === ws) {
							wsRef.current.close(1000, "Kicked by owner");
						}
						navigate({ to: "/" });
						break;
					case "error":
						toast.error(`Server error: ${data.message}`);
						break;
					default:
						console.warn("Received unknown WebSocket message type:", data);
				}
			} catch (error) {
				console.error("Failed to parse WebSocket message:", error, event.data);
				toast.error("Received invalid data from server.");
			}
		};

		const handleClose = (event: CloseEvent) => {
			console.log("WebSocket disconnected", event.code, event.reason);
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
					console.log(
						`Attempting reconnect #${reconnectAttempt.current} in ${delay / 1000}s`,
					);

					if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
					reconnectTimeout.current = setTimeout(() => {
						console.log(
							"Reconnect timer elapsed. Manual refresh may be needed or effect should re-run.",
						);
					}, delay);
				} else if (event.reason && !expectedReasons.includes(event.reason)) {
					toast.info(`Disconnected: ${event.reason}`);
				} else if (!normalClosureCodes.includes(event.code)) {
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
			console.log("WebSocket Effect: Cleanup running.");
			if (reconnectTimeout.current) {
				clearTimeout(reconnectTimeout.current);
				reconnectTimeout.current = null;
			}
			if (wsRef.current === ws && ws.readyState < WebSocket.CLOSING) {
				console.log("WebSocket Effect: Closing connection via cleanup.");
				ws.close(1000, "Client navigating away");
			}
			if (wsRef.current === ws) {
				wsRef.current = null;
				setIsConnected(false);
			}
		};
	}, [
		roomId,
		session?.user?.id,
		session?.user?.username,
		isSessionPending,
		navigate,
		gameState?.currentPlayerSeat,
		gameState?.phase,
	]);

	useEffect(() => {
		if (initialRoomData?.members && members.length === 0) {
			console.log("Setting initial members from query data.");
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
			console.debug("Sending WS Message:", message.type, message);
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
			const currentBet = gameState.currentBet;
			const minRaiseAmount = gameState.minRaiseAmount;
			const playerCurrentBet = playerState.currentBet;
			const minRaiseToValue = Math.min(
				currentBet + minRaiseAmount,
				playerState.stack + playerCurrentBet,
			);
			const maxRaiseValue = playerState.stack + playerCurrentBet;

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

	if (isSessionPending) {
		console.log("Render: Session pending...");
		return <RoomSkeleton />;
	}

	if (!session?.user) {
		console.log("Render: No user session found after loading.");
		return (
			<div className="container p-4 text-center">
				Please log in to view rooms.
				<Button onClick={() => navigate({ to: "/login" })} className="ml-2">
					Login
				</Button>
			</div>
		);
	}

	if (roomId && isRoomLoading) {
		console.log("Render: Room data loading...");
		return <RoomSkeleton />;
	}

	if (roomId && isRoomError) {
		console.error("Render: Error loading room data:", roomError);
		const isNotFoundError =
			roomError instanceof TRPCClientError &&
			roomError.data?.code === "NOT_FOUND";
		const errorMsg = isNotFoundError
			? "The room was not found."
			: "Failed to load room data.";
		return (
			<div className="container mx-auto px-4 py-8 text-center">
				<h1 className="mb-4 font-bold text-destructive text-xl">Error</h1>
				<p className="text-muted-foreground">{errorMsg}</p>
				<Button onClick={() => navigate({ to: "/" })} className="mt-4">
					Go to Home
				</Button>
			</div>
		);
	}

	if (roomId && !isRoomLoading && !initialRoomData) {
		console.log("Render: Room not found after loading.");
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

	if (!initialRoomData) {
		console.error("Render: initialRoomData is unexpectedly null/undefined.");
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
	}

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

	const closeRoomDisabled =
		closeRoom.isPending || !isConnected || isHandInProgress;
	const leaveRoomDisabled =
		leaveRoom.isPending || !isConnected || isHandInProgress;

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
											<Circle className="h-4 w-4 animate-pulse text-red-600" />
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
								{canUpdateMaxPlayers && (
									<UpdateMaxPlayersDialog
										roomId={roomId}
										currentMaxPlayers={room.maxPlayers}
										currentActivePlayers={activeMembers.length}
									/>
								)}
								{isAdmin && room.isActive && (
									<Dialog
										open={isCloseRoomDialogOpen}
										onOpenChange={setIsCloseRoomDialogOpen}
									>
										<Tooltip>
											<TooltipTrigger asChild>
												<span
													tabIndex={closeRoomDisabled ? 0 : -1}
													className={
														closeRoomDisabled ? "cursor-not-allowed" : ""
													}
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
															{closeRoom.isPending
																? "Closing..."
																: "Close Room"}
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
													Are you sure you want to close this room? All players
													will be removed and the game will end.
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
								{isAdmin && room.isActive && (
									<Tooltip>
										<TooltipTrigger asChild>
											<span
												tabIndex={canStartGame ? -1 : 0}
												className={!canStartGame ? "cursor-not-allowed" : ""}
											>
												<Button
													variant="default"
													size="sm"
													onClick={() => {
														if (canStartGame) {
															startGame.mutate(roomId);
														}
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
								{!isAdmin && currentUserMemberInfo?.isActive && (
									<Dialog
										open={isLeaveRoomDialogOpen}
										onOpenChange={setIsLeaveRoomDialogOpen}
									>
										<Tooltip>
											<TooltipTrigger asChild>
												<span
													tabIndex={leaveRoomDisabled ? 0 : -1}
													className={
														leaveRoomDisabled ? "cursor-not-allowed" : ""
													}
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
															{leaveRoom.isPending
																? "Leaving..."
																: "Leave Room"}
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
													Are you sure you want to leave this room? You can
													rejoin later using the join code if the room is still
													open.
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
																			from the room? They will need the join
																			code to rejoin.
																		</DialogDescription>
																	</DialogHeader>
																	<DialogFooter>
																		<DialogClose asChild>
																			<Button variant="outline">Cancel</Button>
																		</DialogClose>
																		<Button
																			variant="destructive"
																			onClick={() => {
																				if (userToKick) {
																					kickUser.mutate({
																						roomId,
																						userIdToKick: userToKick.userId,
																					});
																				}
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

									<HandHistory
										history={gameState.handHistory}
										currentPhase={gameState.phase}
									/>

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
																		Raise amount must be between{" "}
																		{minRaiseToValue} and {maxBetOrRaiseValue}.
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
														if (canBet && allInAmount > 0) {
															sendMessage({
																type: "action",
																action: "bet",
																amount: allInAmount,
															});
														} else if (canRaise && allInAmount > currentBet) {
															sendMessage({
																type: "action",
																action: "raise",
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
						filterProfanity={room.filterProfanity}
						isAdmin={isAdmin}
						onToggleFilter={
							isAdmin
								? (enabled) => {
										updateFilter.mutate({
											roomId,
											filterProfanity: enabled,
										});
									}
								: undefined
						}
						isUpdatingFilter={updateFilter.isPending}
					/>
				</div>
			</div>
		</TooltipProvider>
	);
}
