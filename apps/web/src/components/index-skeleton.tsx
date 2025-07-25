import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

export function IndexSkeleton() {
	return (
		<div className="container mx-auto max-w-7xl px-4 py-8">
			<div className="mx-auto max-w-6xl space-y-8">
				<div className="mx-auto max-w-3xl">
					<div className="grid gap-6">
						<div className="rounded-lg border p-4 text-center">
							<Skeleton className="mx-auto h-4 w-48" />
						</div>

						<div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
							<Skeleton className="h-11 w-full sm:w-40" />
							<Separator
								orientation="vertical"
								className="hidden h-10 sm:block"
							/>
							<Separator
								orientation="horizontal"
								className="block w-full sm:hidden"
							/>
							<Skeleton className="h-11 w-full sm:w-40" />
						</div>
					</div>
				</div>

				<div className="space-y-4">
					<div className="rounded-lg border">
						<div className="p-4">
							<Skeleton className="mb-4 h-6 w-32" />
							<div className="space-y-3">
								{Array.from({ length: 3 }).map((_, i) => (
									<div key={i} className="flex items-center justify-between">
										<div className="flex items-center gap-4">
											<Skeleton className="h-4 w-24" />
											<Skeleton className="h-4 w-16" />
											<Skeleton className="h-4 w-20" />
										</div>
										<Skeleton className="h-8 w-16" />
									</div>
								))}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
