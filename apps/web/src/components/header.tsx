import { authClient } from "@/lib/auth-client";
import { Link } from "@tanstack/react-router";
import { ModeToggle } from "./mode-toggle";
import { ProfilePicture } from "./profile-picture";

export function Header() {
	const { data: session } = authClient.useSession();

	const userImage = session?.user?.image || undefined;
	const userBase64 = session?.user?.imageBase64 || undefined;
	const username = session?.user?.username || "User";

	return (
		<header className="w-full border-b">
			<div className="container mx-auto flex h-16 items-center justify-between px-4">
				<ModeToggle />

				<div className="font-bold text-xl">
					<Link to="/" className="transition-opacity hover:opacity-80">
						No Stakes Poker
					</Link>
				</div>

				<div className="flex justify-end">
					<Link to="/account" className="transition-opacity hover:opacity-80">
						<ProfilePicture
							imageUrl={userImage}
							imageBase64={userBase64}
							alt={`${username}'s avatar`}
							username={username}
							size="md"
						/>
					</Link>
				</div>
			</div>
		</header>
	);
}
