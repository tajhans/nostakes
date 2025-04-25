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
			</div>
		</div>
	);
}
