import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { Filter } from "bad-words";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { ChatMessage } from "@/types";

interface RoomChatProps {
	messages: ChatMessage[];
	sendMessage: (message: string) => void;
	isConnected: boolean;
	currentUserId: string;
	filterProfanity?: boolean;
	isAdmin?: boolean;
	onToggleFilter?: (enabled: boolean) => void;
	isUpdatingFilter?: boolean;
}

interface GroupedMessage extends ChatMessage {
	isConsecutive: boolean;
	isCurrentUser: boolean;
}

const MAX_MESSAGE_LENGTH = 64;
const MIN_MESSAGE_INTERVAL = 2000;

export function RoomChat({
	messages,
	sendMessage: sendChatMessageProp,
	isConnected,
	currentUserId,
	filterProfanity = false,
	isAdmin = false,
	onToggleFilter,
	isUpdatingFilter = false,
}: RoomChatProps) {
	const [messageInput, setMessageInput] = useState("");
	const scrollAreaRef = useRef<HTMLDivElement>(null);
	const filter = useRef(new Filter());
	const lastMessageTime = useRef<number>(0);

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
	}, []);

	const handleSend = async () => {
		const trimmedMessage = messageInput.trim();
		if (!trimmedMessage) return;

		const now = Date.now();
		const timeSinceLastMessage = now - lastMessageTime.current;
		if (timeSinceLastMessage < MIN_MESSAGE_INTERVAL) {
			toast.error(
				`Please wait ${Math.ceil((MIN_MESSAGE_INTERVAL - timeSinceLastMessage) / 1000)} second(s) before sending another message.`,
			);
			return;
		}

		const messageToSend = trimmedMessage.substring(0, MAX_MESSAGE_LENGTH);
		const finalMessage = filterProfanity
			? filter.current.clean(messageToSend)
			: messageToSend;

		sendChatMessageProp(finalMessage);
		setMessageInput("");
		lastMessageTime.current = now;
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
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<Badge variant="secondary" className="text-sm">
								{filterProfanity ? "Filtered" : "Unfiltered"}
							</Badge>
						</TooltipTrigger>
						<TooltipContent>
							{filterProfanity
								? "Profanity is being filtered from messages"
								: "Messages are not being filtered for profanity"}
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
				{isAdmin && onToggleFilter && (
					<div className="ml-auto flex items-center gap-2">
						<Label htmlFor="chat-filter" className="text-sm">
							Filter Chat
						</Label>
						<Switch
							id="chat-filter"
							checked={filterProfanity}
							onCheckedChange={onToggleFilter}
							disabled={!isConnected || isUpdatingFilter}
							aria-label="Toggle chat profanity filter"
						/>
						{isUpdatingFilter && (
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
						)}
					</div>
				)}
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
