import Loader from "@/components/loader";
import { RoomChat } from "@/components/room-chat";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { trpcClient } from "@/utils/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// --- Types (mirroring server types) ---
interface ChatMessage {
	type: "chat";
	id: string;
	roomId: string;
	userId: string;
	username: string;
	message: string;
	timestamp: number;
}

interface MessageHistory {
	type: "history";
	messages: ChatMessage[];
}

interface RoomMemberInfo {
	userId: string;
	username: string | null; // Allow null from DB join
	seatNumber: number;
	currentStack: number;
	isActive: boolean;
	image?: string | null; // Add image if available
	// Add other relevant fields from the grouped query if needed
}

interface RoomStateUpdate {
	type: "room_state";
	members: RoomMemberInfo[];
}

interface RoomClosed {
	type: "room_closed";
}

type ServerWebSocketMessage =
	| ChatMessage
	| MessageHistory
	| RoomStateUpdate
	| RoomClosed;

// --- Component ---

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

	// Local state for real-time data
	const [members, setMembers] = useState<RoomMemberInfo[]>([]);
	const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
	const [isConnected, setIsConnected] = useState(false);
	const wsRef = useRef<WebSocket | null>(null);

	// Fetch initial room data (including members) via tRPC
	// We use getRooms and find the specific room. Consider a getRoomById tRPC procedure later.
	const { data: initialRoomData, isLoading: isRoomLoading } = useQuery({
		...trpc.getRooms.queryOptions(),
		enabled: !!session,
		select: (data) => data.find((r) => r.id === roomId),
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

	useEffect(() => {
		if (!session?.user || !roomId || !initialRoomData) {
			return;
		}

		if (wsRef.current) {
			wsRef.current.close();
		}

		const serverUrl = new URL(import.meta.env.VITE_SERVER_URL);
		const wsUrl = `ws://${serverUrl.hostname}:3002?roomId=${roomId}&userId=${session.user.id}&username=${encodeURIComponent(session.user.username || "Anonymous")}`;
		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		ws.onopen = () => {
			console.log("WebSocket connected");
			setIsConnected(true);
		};

		ws.onmessage = (event) => {
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
					case "room_state":
						setMembers(data.members);
						break;
					case "room_closed":
						toast.info("The room has been closed by the owner.");
						ws.close();
						navigate({ to: "/" });
						break;
					default:
						console.warn("Received unknown WebSocket message type:", data);
				}
			} catch (error) {
				console.error("Failed to parse WebSocket message:", error);
			}
		};

		ws.onclose = (event) => {
			console.log("WebSocket disconnected", event.code, event.reason);
			setIsConnected(false);
			// Optional: Implement reconnection logic here if needed
			if (event.code !== 1000 && event.code !== 1005 && event.code !== 1011) {
				toast.error("Chat connection lost. Please refresh the page.");
			}
			wsRef.current = null;
		};

		ws.onerror = (error) => {
			console.error("WebSocket error:", error);
			toast.error("WebSocket connection error.");
			setIsConnected(false);
			wsRef.current = null;
		};

		return () => {
			console.log("Closing WebSocket connection");
			ws.close(1000, "Client navigating away");
			wsRef.current = null;
		};
	}, [roomId, session, initialRoomData, navigate]);

	useEffect(() => {
		if (initialRoomData?.members) {
			setMembers(initialRoomData.members);
		}
	}, [initialRoomData]);

	const sendChatMessage = (message: string) => {
		if (
			wsRef.current &&
			wsRef.current.readyState === WebSocket.OPEN &&
			message.trim()
		) {
			wsRef.current.send(
				JSON.stringify({ type: "chat", message: message.trim() }),
			);
		} else {
			toast.error("Cannot send message. Chat not connected.");
		}
	};

	if (isSessionPending || isRoomLoading) {
		return <Loader />;
	}

	if (!session?.user) {
		navigate({ to: "/login", search: { redirect: Route.fullPath } });
		return <Loader />;
	}

	if (!isRoomLoading && !initialRoomData) {
		return (
			<div className="container mx-auto px-4 py-8 text-center">
				<h1 className="mb-4 font-bold text-xl">Room Not Found</h1>
				<p className="text-muted-foreground">
					The room you are looking for does not exist or you may not have access
					to it.
				</p>
				<Button onClick={() => navigate({ to: "/" })} className="mt-4">
					Go to Dashboard
				</Button>
			</div>
		);
	}

	const room = initialRoomData;
	const activeMembers = members.filter((m) => m.isActive);
	const isAdmin = session.user.id === room?.ownerId;

	return (
		<div className="container mx-auto max-w-5xl px-4 py-2">
			<div className="grid gap-4 lg:grid-cols-[1fr_400px]">
				<div className="space-y-4">
					<div className="mb-4 flex items-center justify-between gap-4">
						<div>
							<h1 className="font-bold text-lg">Room {room?.joinCode}</h1>
							<span
								className={`text-xs ${isConnected ? "text-green-500" : "text-red-500"}`}
							>
								{isConnected ? "Connected" : "Disconnected"}
							</span>
						</div>
						<div className="flex gap-2">
							{isAdmin && room?.isActive && (
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
							{!isAdmin && (
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
						<div className="text-muted-foreground text-sm">
							<p>
								Players: {activeMembers.length}/{room?.maxPlayers}
							</p>
							<p>Starting Stack: {room?.startingStack}</p>
							<p>Status: {room?.isActive ? "Open" : "Closed"}</p>
						</div>
					</div>

					<div className="rounded-lg border p-4">
						<h2 className="mb-2 font-medium">Players</h2>
						{activeMembers.length > 0 ? (
							<div className="grid gap-2">
								{activeMembers
									.sort((a, b) => a.seatNumber - b.seatNumber)
									.map((member) => (
										<div
											key={member.userId}
											className="flex items-center justify-between rounded bg-accent/50 p-2"
										>
											<div className="flex items-center gap-2">
												<span className="text-muted-foreground text-xs">
													Seat {member.seatNumber}
												</span>
												<span className="font-medium text-sm">
													{member.username ||
														`User ${member.userId.substring(0, 4)}`}
													{member.userId === room?.ownerId ? " Admin" : ""}
													{member.userId === session.user.id ? " You" : ""}
												</span>
											</div>
											<span className="font-mono text-sm">
												{member.currentStack}
											</span>
										</div>
									))}
							</div>
						) : (
							<p className="text-muted-foreground text-sm">
								No active players.
							</p>
						)}
					</div>

					{/* Placeholder for Game Area */}
					<div className="flex min-h-[200px] items-center justify-center rounded-lg border p-4">
						<p className="text-muted-foreground">
							Poker Game Area - Coming Soon!
						</p>
					</div>
				</div>

				{/* Right Column: Chat */}
				<RoomChat
					messages={chatMessages}
					sendMessage={sendChatMessage}
					isConnected={isConnected}
					currentUserId={session.user.id} // Pass current user ID for styling
				/>
			</div>
		</div>
	);
}
