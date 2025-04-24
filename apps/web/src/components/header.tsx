import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { Link } from "@tanstack/react-router";
import { User } from "lucide-react";
import { ModeToggle } from "./mode-toggle";

export function Header() {
	const { data: session } = authClient.useSession();

	const userImage = session?.user?.image || undefined;
	const username = session?.user?.username || "User avatar";

	return (
		<header className="w-full border-b">
			<div className="container mx-auto flex h-16 items-center justify-between px-4">
				<ModeToggle />

				<div className="font-bold text-xl">
					<Link to="/" className="transition-opacity hover:opacity-80">
						No Stakes Poker
					</Link>
				</div>

				<div className="flex w-[100px] justify-end">
					<Link to="/account" className="transition-opacity hover:opacity-80">
						{userImage ? (
							<img
								src={userImage}
								alt={username}
								className="h-8 w-8 rounded-full"
							/>
						) : (
							<Button variant="ghost" size="icon" className="h-8 w-8">
								<User className="h-5 w-5" />
							</Button>
						)}
					</Link>
				</div>
			</div>
		</header>
	);
}
