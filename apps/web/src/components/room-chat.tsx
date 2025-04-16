import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useRef, useState } from "react";

interface ChatMessage {
	id: string;
	type: "chat";
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

type WebSocketMessage = ChatMessage | MessageHistory;

interface RoomChatProps {
	roomId: string;
	userId: string;
	username: string;
}

interface GroupedMessage extends ChatMessage {
	isConsecutive?: boolean;
}

export function RoomChat({ roomId, userId, username }: RoomChatProps) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [messageInput, setMessageInput] = useState("");
	const [isConnected, setIsConnected] = useState(false);
	const wsRef = useRef<WebSocket | null>(null);
	const scrollAreaRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const ws = new WebSocket(
			`ws://100.119.141.108:3002?roomId=${roomId}&userId=${userId}&username=${username}`,
		);

		ws.onopen = () => {
			setIsConnected(true);
		};

		ws.onmessage = (event) => {
			try {
				const data: WebSocketMessage = JSON.parse(event.data);
				if (data.type === "chat") {
					setMessages((prev) =>
						[...prev, data].sort((a, b) => a.timestamp - b.timestamp),
					);
				} else if (data.type === "history") {
					setMessages(data.messages.sort((a, b) => a.timestamp - b.timestamp));
				}
			} catch (error) {
				console.error("Failed to parse WebSocket message:", error);
			}
		};

		ws.onclose = () => {
			setIsConnected(false);
		};

		wsRef.current = ws;

		return () => {
			ws.close();
		};
	}, [roomId, userId, username]);

	const sendMessage = () => {
		if (!messageInput.trim() || !wsRef.current) return;

		const message = {
			roomId,
			userId,
			username,
			message: messageInput.trim(),
		};

		wsRef.current.send(JSON.stringify({ type: "chat", ...message }));
		setMessageInput("");
	};

	const groupedMessages: GroupedMessage[] = messages.map(
		(msg, index, array) => {
			const prevMessage = array[index - 1];
			const isConsecutive = prevMessage && prevMessage.userId === msg.userId;
			return {
				...msg,
				isConsecutive,
			};
		},
	);

	return (
		<Card className="flex h-[500px] flex-col">
			<CardHeader>
				<CardTitle className="text-lg">Room Chat</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-1 flex-col gap-4">
				<ScrollArea
					ref={scrollAreaRef}
					className="h-[250px] flex-1 pr-4"
					type="always"
				>
					<div className="space-y-1">
						{groupedMessages.map((msg, index) => (
							<div
								key={msg.id}
								className={`flex flex-col ${
									msg.userId === userId ? "items-end" : "items-start"
								} ${msg.isConsecutive ? "mt-1" : "mt-4"}`}
							>
								{!msg.isConsecutive && (
									<span className="mb-1 text-muted-foreground text-xs">
										{msg.username}
									</span>
								)}
								<div
									className={`max-w-[80%] rounded-lg p-2 ${
										msg.userId === userId
											? "bg-primary text-primary-foreground"
											: "bg-muted"
									}`}
								>
									<p className="text-sm">{msg.message}</p>
								</div>
							</div>
						))}
					</div>
				</ScrollArea>
				<div className="flex gap-2">
					<Input
						value={messageInput}
						onChange={(e) => setMessageInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								sendMessage();
							}
						}}
						placeholder={
							isConnected ? "Type a message..." : "Connecting to chat..."
						}
						disabled={!isConnected}
					/>
					<Button
						onClick={sendMessage}
						disabled={!isConnected || !messageInput.trim()}
					>
						Send
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
