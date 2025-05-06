import { Separator } from "@/components/ui/separator";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";

export function Footer() {
	const healthCheck = useQuery(trpc.healthCheck.queryOptions());

	return (
		<div className="py-2">
			<Separator />
			<div className="flex items-center justify-center gap-2 py-2">
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger>
							<div
								className={`h-2 w-2 rounded-full ${
									healthCheck.data ? "bg-green-500" : "bg-red-500"
								}`}
							/>
						</TooltipTrigger>
						<TooltipContent>
							<p>
								{healthCheck.isLoading
									? "Checking service..."
									: healthCheck.data
										? "Service working"
										: "Service not working"}
							</p>
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
				<p className="text-sm">Made with ❤️</p>
			</div>
			<div className="flex justify-center">
				<a
					href="https://github.com/tajhans/nostakes"
					target="_blank"
					rel="noopener noreferrer"
					className="transition-opacity hover:opacity-80"
				>
					<img
						src="/github.svg"
						width={20}
						height={20}
						alt="GitHub Repository"
						className="dark:invert"
					/>
				</a>
			</div>
		</div>
	);
}
