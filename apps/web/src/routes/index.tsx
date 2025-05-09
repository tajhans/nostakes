import CreateRoomForm from "@/components/create-room-form";
import JoinRoomForm from "@/components/join-room-form";
import Loader from "@/components/loader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { PlayCircle, Settings, ShieldCheck, Users } from "lucide-react";

export const Route = createFileRoute("/")({
	component: HomeComponent,
});

function HomeComponent() {
	const { data: session, isPending: isSessionPending } =
		authClient.useSession();

	const { data: activeRoom, isLoading: isRoomLoading } = useQuery({
		...trpc.getActiveRoom.queryOptions(),
		enabled: !!session,
	});

	if (isSessionPending) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<Loader />
			</div>
		);
	}

	return (
		<div className="container mx-auto max-w-5xl px-4 py-8">
			{session ? (
				<div className="mx-auto max-w-3xl">
					<div className="grid gap-6">
						<div>
							{isRoomLoading ? (
								<div className="rounded-lg border p-4 text-center">
									<span className="text-muted-foreground">
										Loading room status...
									</span>
								</div>
							) : activeRoom ? (
								<div className="rounded-lg border p-4 text-center">
									<p className="mb-2 font-semibold">
										You have an active room session!
									</p>
									<Link to="/room" search={{ id: activeRoom.roomId }}>
										<Button variant="default" size="lg">
											Reconnect to Room
										</Button>
									</Link>
								</div>
							) : (
								<div className="rounded-lg border p-4 text-center">
									<span className="text-muted-foreground">
										No active room session.
									</span>
								</div>
							)}
						</div>

						<div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
							<Dialog>
								<DialogTrigger asChild>
									<Button size="lg" className="w-full sm:w-auto">
										Create New Room
									</Button>
								</DialogTrigger>
								<CreateRoomForm />
							</Dialog>

							<Separator
								orientation="vertical"
								className="hidden h-10 sm:block"
							/>
							<Separator
								orientation="horizontal"
								className="block w-full sm:hidden"
							/>

							<Dialog>
								<DialogTrigger asChild>
									<Button
										variant="outline"
										size="lg"
										className="w-full sm:w-auto"
									>
										Join Existing Room
									</Button>
								</DialogTrigger>
								<JoinRoomForm />
							</Dialog>
						</div>
					</div>
				</div>
			) : (
				<div className="flex flex-col items-center text-center">
					<h1 className="mb-4 font-bold text-2xl tracking-tight sm:text-5xl md:text-6xl">
						Welcome to No Stakes Poker!
					</h1>
					<p className="mb-8 max-w-xl text-md text-muted-foreground sm:max-w-2xl sm:text-xl">
						Enjoy the thrill of Texas Hold'em with your friends, completely free
						and without any real money involved. Create private rooms, customize
						your game, and focus on the fun.
					</p>
					<Link to="/login">
						<Button size="lg" className="mb-12 px-8 py-6 text-lg sm:mb-16">
							Sign Up
						</Button>
					</Link>

					<div className="mb-12 grid w-full gap-8 md:grid-cols-3 md:gap-12">
						<div className="flex flex-col items-center rounded-lg border bg-card p-6 shadow-sm">
							<Users className="mb-4 h-10 w-10 text-primary sm:h-12 sm:w-12" />
							<h3 className="mb-2 font-semibold text-xl sm:text-2xl">
								Play with Friends
							</h3>
							<p className="text-muted-foreground">
								Easily create or join private poker rooms to play with your
								group.
							</p>
						</div>
						<div className="flex flex-col items-center rounded-lg border bg-card p-6 shadow-sm">
							<ShieldCheck className="mb-4 h-10 w-10 text-primary sm:h-12 sm:w-12" />
							<h3 className="mb-2 font-semibold text-xl sm:text-2xl">
								Zero Risk, All Fun
							</h3>
							<p className="text-muted-foreground">
								Experience poker strategy and excitement without wagering real
								money.
							</p>
						</div>
						<div className="flex flex-col items-center rounded-lg border bg-card p-6 shadow-sm">
							<Settings className="mb-4 h-10 w-10 text-primary sm:h-12 sm:w-12" />
							<h3 className="mb-2 font-semibold text-xl sm:text-2xl">
								Customizable Games
							</h3>
							<p className="text-muted-foreground">
								Set your own rules: starting stacks, blinds, antes, and more.
							</p>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
