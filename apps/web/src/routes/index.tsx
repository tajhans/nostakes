import CreateRoomForm from "@/components/create-room-form";
import JoinRoomForm from "@/components/join-room-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: HomeComponent,
});

function HomeComponent() {
	const { data: session, isPending } = authClient.useSession();
	const healthCheck = useQuery(trpc.healthCheck.queryOptions());

	const { data: activeRoom, isLoading: isRoomLoading } = useQuery({
		...trpc.getActiveRoom.queryOptions(),
		enabled: !!session,
	});

	return (
		<div className="container mx-auto max-w-3xl px-4 py-2">
			<div className="grid gap-6">
				<section className="rounded-lg border p-4">
					<h2 className="mb-2 font-medium">API Status</h2>
					<div className="flex items-center gap-2">
						<div
							className={`h-2 w-2 rounded-full ${
								healthCheck.data ? "bg-green-500" : "bg-red-500"
							}`}
						/>
						<span className="text-muted-foreground text-sm">
							{healthCheck.isLoading
								? "Checking..."
								: healthCheck.data
									? "Connected"
									: "Disconnected"}
						</span>
					</div>
				</section>

				<div className="flex justify-center gap-4">
					{isPending ? (
						<span className="text-muted-foreground text-sm">Loading...</span>
					) : session ? (
						<>
							<Dialog>
								<DialogTrigger asChild>
									<Button>Create Room</Button>
								</DialogTrigger>
								<CreateRoomForm />
							</Dialog>

							<Separator orientation="vertical" className="h-6" />

							<Dialog>
								<DialogTrigger asChild>
									<Button variant="outline">Join Room</Button>
								</DialogTrigger>
								<JoinRoomForm />
							</Dialog>
						</>
					) : (
						<Link to="/login">
							<Button>Sign Up</Button>
						</Link>
					)}
				</div>

				{session && (
					<div>
						{isRoomLoading ? (
							<div className="rounded-lg border p-4">
								<span className="text-muted-foreground">
									Loading room status...
								</span>
							</div>
						) : activeRoom != null ? (
							<div className="rounded-lg border p-4">
								<p className="mb-2">You have an active room session</p>
								<Link to="/room" search={{ id: activeRoom.roomId }}>
									<Button variant="default">Reconnect to Room</Button>
								</Link>
							</div>
						) : (
							<div className="rounded-lg border p-4">
								<span className="text-muted-foreground">
									No active room session
								</span>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
