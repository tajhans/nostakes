import { Skeleton } from "@/components/ui/skeleton";

export function AccountSkeleton() {
	return (
		<div className="container mx-auto max-w-3xl px-4 py-8">
			<div className="animate-pulse space-y-6 rounded-lg border p-6">
				<div className="flex items-center gap-6">
					<Skeleton className="h-24 w-24 shrink-0 rounded-full" />
					<div className="min-w-0 flex-1 space-y-2">
						<Skeleton className="h-7 w-40" />
						<Skeleton className="h-4 w-56" />
					</div>
				</div>

				<div className="space-y-4">
					<Skeleton className="h-6 w-32" />
					<Skeleton className="h-32 w-full rounded-md" />
				</div>

				<div className="border-t pt-6">
					<Skeleton className="h-10 w-24 rounded-md" />{" "}
				</div>
			</div>
		</div>
	);
}
