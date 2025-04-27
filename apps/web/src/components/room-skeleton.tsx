import { Skeleton } from "@/components/ui/skeleton";

export function RoomSkeleton() {
	return (
		<div className="container mx-auto max-w-5xl px-4 py-2">
			<div className="grid animate-pulse gap-4 lg:grid-cols-[1fr_400px]">
				<div className="space-y-4">
					<div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
						<div className="flex items-center gap-2">
							<Skeleton className="h-5 w-20" />
							<Skeleton className="h-8 w-36" />
							<Skeleton className="h-6 w-6 rounded-full" />
						</div>
						<div className="flex flex-wrap items-center justify-end gap-2">
							<Skeleton className="h-8 w-24" />
							<Skeleton className="h-8 w-24" />
							<Skeleton className="h-8 w-24" />
						</div>
					</div>

					<div className="rounded-lg border p-4">
						<Skeleton className="mb-3 h-5 w-28" />
						<div className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
							<Skeleton className="h-4 w-3/4" />
							<Skeleton className="h-4 w-2/3" />
							<Skeleton className="h-4 w-1/2" />
							<Skeleton className="h-4 w-3/5" />
							<Skeleton className="h-4 w-2/5" />
							<Skeleton className="h-4 w-1/3" />
						</div>
					</div>

					<div className="rounded-lg border p-4">
						<Skeleton className="mb-3 h-5 w-20" />
						<div className="grid gap-2">
							{[...Array(3)].map((_, i) => (
								<div
									key={i}
									className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded bg-accent/50 p-2"
								>
									<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
										<Skeleton className="h-4 w-14" />
										<Skeleton className="h-5 w-24" />
										<Skeleton className="h-4 w-16" />
									</div>
									<Skeleton className="h-5 w-12" />
								</div>
							))}
						</div>
					</div>

					<div className="flex min-h-[300px] flex-col items-center justify-center rounded-lg border p-4">
						<Skeleton className="mb-4 h-5 w-40" />
						<div className="w-full space-y-4 text-center">
							<div className="mb-4">
								<Skeleton className="mx-auto mb-2 h-4 w-32" />
								<div className="flex min-h-[36px] flex-wrap items-center justify-center gap-2">
									<Skeleton className="h-28 w-[5.25rem] rounded" />
									<Skeleton className="h-28 w-[5.25rem] rounded" />
									<Skeleton className="h-28 w-[5.25rem] rounded" />
									<Skeleton className="h-28 w-[5.25rem] rounded" />
									<Skeleton className="h-28 w-[5.25rem] rounded" />
								</div>
							</div>
							<Skeleton className="mx-auto h-6 w-24" />
							<div className="h-96 w-full rounded-md border p-4">
								<Skeleton className="mb-2 h-4 w-full" />
								<Skeleton className="mb-2 h-4 w-5/6" />
								<Skeleton className="mb-2 h-4 w-3/4" />
							</div>
							<div className="mt-4 flex flex-wrap items-center justify-center gap-2 border-t pt-4">
								<Skeleton className="h-8 w-20" />
								<Skeleton className="h-8 w-20" />
								<Skeleton className="h-8 w-24" />
								<Skeleton className="h-8 w-28" />
							</div>
						</div>
					</div>
				</div>

				<div className="flex h-full flex-col rounded-lg border p-4">
					<div className="mb-2 flex items-center gap-2">
						<Skeleton className="h-5 w-12" />
						<Skeleton className="h-5 w-24" />
					</div>
					<div className="flex-grow space-y-3 overflow-hidden py-4 pr-4">
						{[...Array(5)].map((_, i) => (
							<div
								key={i}
								className={`flex flex-col ${i % 2 === 0 ? "items-start" : "items-end"}`}
							>
								<Skeleton className="mb-1 h-3 w-16" />
								<Skeleton className="h-8 w-3/4 rounded-lg" />
							</div>
						))}
					</div>
					<div className="mt-4 flex gap-2 border-t pt-4">
						<Skeleton className="h-9 flex-1" />
						<Skeleton className="h-9 w-20" />
					</div>
				</div>
			</div>
		</div>
	);
}
