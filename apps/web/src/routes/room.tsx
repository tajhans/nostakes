import Loader from "@/components/loader";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { trpcClient } from "@/utils/trpc";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

interface Room {
	id: string;
	joinCode: string;
	maxPlayers: number;
	startingStack: number;
	isActive: boolean;
	createdAt: Date;
	ownerId: string;
	members: Array<{
		id: string;
		userId: string;
		isActive: boolean;
		seatNumber: number;
		currentStack: number;
	}>;
}

export const Route = createFileRoute("/room")({
	validateSearch: (search) => ({
		id: search.id as string,
	}),
	component: RouteComponent,
});

function RouteComponent() {
	const { id } = Route.useSearch();
	const { data: session } = authClient.useSession();
	const navigate = Route.useNavigate();

	const { data: rooms, isLoading } = useQuery({
		...trpc.getRooms.queryOptions(),
		select: (data): Room[] => data,
	});

	const closeRoom = useMutation({
		mutationFn: async (roomId: string) => {
			return trpcClient.closeRoom.mutate({ roomId });
		},
		onSuccess: () => {
			toast.success("Room closed successfully");
			navigate({ to: "/" });
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	if (isLoading) {
		return <Loader />;
	}

	const room = rooms?.find((r) => r.id === id);

	if (!room) {
		return <div>Room not found</div>;
	}

	const isAdmin = session?.user.id === room.ownerId;
	const activeMembers = room.members.filter((m) => m.isActive);

	return (
		<div className="container mx-auto max-w-3xl px-4 py-2">
			<div className="mb-4 flex items-center justify-between">
				<h1 className="font-bold text-lg">Room {room.joinCode}</h1>
				{isAdmin && room.isActive && (
					<div className="flex gap-2">
						<Button
							variant="destructive"
							size="sm"
							onClick={() => {
								if (
									window.confirm(
										"Are you sure you want to close this room? All players will be removed.",
									)
								) {
									closeRoom.mutate(room.id);
								}
							}}
							disabled={closeRoom.isPending}
						>
							{closeRoom.isPending ? "Closing..." : "Close Room"}
						</Button>
					</div>
				)}
			</div>
			<div className="grid gap-4">
				<div className="rounded-lg border p-4">
					<h2 className="mb-2 font-medium">Room Info</h2>
					<div className="text-muted-foreground text-sm">
						<p>
							Players: {activeMembers.length}/{room.maxPlayers}
						</p>
						<p>Starting Stack: {room.startingStack}</p>
						<p>Status: {room.isActive ? "Open" : "Closed"}</p>
					</div>
				</div>
				<div className="rounded-lg border p-4">
					<h2 className="mb-2 font-medium">Players</h2>
					<div className="grid gap-2">
						{activeMembers.map((member) => (
							<div
								key={member.id}
								className="flex items-center justify-between rounded bg-accent/50 p-2"
							>
								<div className="flex items-center gap-2">
									<span className="text-sm">Seat {member.seatNumber}</span>
									<span className="font-medium text-sm">
										{member.userId === room.ownerId ? "Admin " : ""}
										{member.userId === session?.user.id ? "You" : "Player"}
									</span>
								</div>
								<span className="text-sm">{member.currentStack}</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
