import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Filter } from "bad-words";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface ChatMessage {
	id: string;
	type: "chat";
	roomId: string;
	userId: string;
	username: string;
	message: string;
	timestamp: number;
}

interface RoomChatProps {
	messages: ChatMessage[];
	sendMessage: (message: string) => void;
	isConnected: boolean;
	currentUserId: string;
	filterProfanity?: boolean;
}

interface GroupedMessage extends ChatMessage {
	isConsecutive: boolean;
	isCurrentUser: boolean;
}

const MAX_MESSAGE_LENGTH = 32;

export function RoomChat({
	messages,
	sendMessage: sendChatMessageProp,
	isConnected,
	currentUserId,
	filterProfanity = false,
}: RoomChatProps) {
	const [messageInput, setMessageInput] = useState("");
	const scrollAreaRef = useRef<HTMLDivElement>(null);
	const filter = useRef(new Filter());

	useEffect(() => {
		if (scrollAreaRef.current) {
			const scrollElement = scrollAreaRef.current.querySelector(
				"[data-radix-scroll-area-viewport]",
			);
			if (scrollElement) {
				scrollElement.scrollTop = scrollElement.scrollHeight;
			} else {
				scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
			}
		}
	}, [messages]);

	const handleSend = async () => {
		const trimmedMessage = messageInput.trim();
		if (!trimmedMessage) return;

		const messageToSend = trimmedMessage.substring(0, MAX_MESSAGE_LENGTH);

		const finalMessage = filterProfanity
			? filter.current.clean(messageToSend)
			: messageToSend;

		sendChatMessageProp(finalMessage);
		setMessageInput("");
	};

	const groupedMessages: GroupedMessage[] = messages.map(
		(msg, index, array) => {
			const prevMessage = array[index - 1];
			const isConsecutive =
				prevMessage &&
				prevMessage.userId === msg.userId &&
				msg.timestamp - prevMessage.timestamp < 5 * 60 * 1000;
			const isCurrentUser = msg.userId === currentUserId;
			return {
				...msg,
				isConsecutive,
				isCurrentUser,
			};
		},
	);

	return (
		<div className="flex h-full flex-col overflow-hidden rounded-lg border p-4">
			<div className="mb-2 flex items-center gap-2">
				<h2 className="font-medium">Chat</h2>
				<Badge variant="secondary" className="text-sm">
					{filterProfanity ? "Profanity Filter On" : "Unfiltered"}
				</Badge>
			</div>
			<ScrollArea ref={scrollAreaRef} className="h-0 flex-grow" type="always">
				<div className="space-y-1 pr-4 pb-4">
					{groupedMessages.map((msg) => (
						<div
							key={msg.id}
							className={`flex flex-col ${
								msg.isCurrentUser ? "items-end" : "items-start"
							} ${msg.isConsecutive ? "mt-1" : "mt-3"}`}
						>
							{!msg.isConsecutive && (
								<span
									className={`mb-1 text-muted-foreground text-xs ${msg.isCurrentUser ? "mr-2 text-right" : "ml-2 text-left"}`}
								>
									{msg.username}
								</span>
							)}
							<div
								className={`max-w-[80%] rounded-lg px-3 py-2 ${
									msg.isCurrentUser
										? "bg-primary text-primary-foreground"
										: "bg-muted"
								}`}
							>
								<p className="break-words text-sm">{msg.message}</p>
							</div>
						</div>
					))}
				</div>
			</ScrollArea>
			<div className="mt-4 flex gap-2 pt-4">
				<Input
					value={messageInput}
					onChange={(e) => setMessageInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							handleSend();
						}
					}}
					placeholder={
						isConnected ? "Type a message..." : "Connecting to chat..."
					}
					disabled={!isConnected}
					maxLength={MAX_MESSAGE_LENGTH}
					className="flex-1"
				/>
				<Button
					onClick={handleSend}
					disabled={!isConnected || !messageInput.trim()}
				>
					Send
				</Button>
			</div>
		</div>
	);
}
