import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { RoomData } from "@/types";
import {
	flexRender,
	getCoreRowModel,
	getFacetedMinMaxValues,
	getFacetedRowModel,
	getFacetedUniqueValues,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
} from "@tanstack/react-table";
import type {
	Column,
	ColumnDef,
	ColumnFiltersState,
	PaginationState,
	SortingState,
} from "@tanstack/react-table";
import { ChevronDownIcon, ChevronUpIcon, Users } from "lucide-react";
import { useState } from "react";

const columns: ColumnDef<RoomData>[] = [
	{
		header: "Join Code",
		accessorKey: "joinCode",
		cell: ({ row }) => {
			const code = row.getValue("joinCode") as string;
			return (
				<div className="font-mono text-sm tracking-wider">
					{code ? `${code.substring(0, 4)}-${code.substring(4, 8)}` : "N/A"}
				</div>
			);
		},
	},
	{
		header: "Visibility",
		accessorKey: "public",
		cell: ({ row }) => {
			const isPublic = row.getValue("public") as boolean;
			return isPublic ? (
				<Badge variant="secondary">Public</Badge>
			) : (
				<Badge variant="outline">Friend's Room</Badge>
			);
		},
		meta: {
			filterVariant: "select",
		},
		filterFn: (row, id, value) => {
			return value === "" || String(row.getValue(id)) === value;
		},
	},
	{
		header: "Players",
		accessorKey: "maxPlayers",
		cell: ({ row }) => {
			const maxPlayers = row.getValue("maxPlayers") as number;
			const members = (row.original.members || []).filter((m) => m.isActive);
			return (
				<div className="flex items-center gap-1">
					<Users className="h-4 w-4" />
					<span>
						{members.length}/{maxPlayers}
					</span>
				</div>
			);
		},
		meta: {
			filterVariant: "range",
		},
	},
	{
		header: "Starting Stack",
		accessorKey: "startingStack",
		cell: ({ row }) => {
			const stack = Number.parseInt(row.getValue("startingStack"));
			return new Intl.NumberFormat("en-US", {
				notation: "compact",
				maximumFractionDigits: 1,
			}).format(stack);
		},
		meta: {
			filterVariant: "range",
		},
	},
	{
		header: "Small Blind",
		accessorKey: "smallBlind",
		cell: ({ row }) => {
			const blind = Number.parseInt(row.getValue("smallBlind"));
			return new Intl.NumberFormat("en-US", {
				notation: "compact",
				maximumFractionDigits: 1,
			}).format(blind);
		},
		meta: {
			filterVariant: "range",
		},
	},
	{
		header: "Big Blind",
		accessorKey: "bigBlind",
		cell: ({ row }) => {
			const blind = Number.parseInt(row.getValue("bigBlind"));
			return new Intl.NumberFormat("en-US", {
				notation: "compact",
				maximumFractionDigits: 1,
			}).format(blind);
		},
		meta: {
			filterVariant: "range",
		},
	},
	{
		header: "Ante",
		accessorKey: "ante",
		cell: ({ row }) => {
			const ante = Number.parseInt(row.getValue("ante"));
			return new Intl.NumberFormat("en-US", {
				notation: "compact",
				maximumFractionDigits: 1,
			}).format(ante);
		},
		meta: {
			filterVariant: "range",
		},
	},
];

interface DiscoverableRoomsTableProps {
	rooms: RoomData[];
}

export function DiscoverableRoomsTable({ rooms }: DiscoverableRoomsTableProps) {
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [sorting, setSorting] = useState<SortingState>([
		{
			id: "isActive",
			desc: true,
		},
	]);
	const [pagination, setPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: 10,
	});

	const table = useReactTable({
		data: rooms,
		columns,
		state: {
			sorting,
			columnFilters,
			pagination,
		},
		onColumnFiltersChange: setColumnFilters,
		onSortingChange: setSorting,
		onPaginationChange: setPagination,
		getCoreRowModel: getCoreRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getFacetedRowModel: getFacetedRowModel(),
		getFacetedUniqueValues: getFacetedUniqueValues(),
		getFacetedMinMaxValues: getFacetedMinMaxValues(),
		enableSortingRemoval: false,
	});

	return (
		<div className="mx-auto max-w-4xl space-y-6 rounded-lg border p-6">
			<h2 className="text-center font-bold text-xl">Discover Rooms</h2>

			{/* Filters */}
			<div className="grid grid-cols-7 gap-2">
				<div /> {/* Empty space for Join Code column */}
				<div className="w-28">
					{table.getColumn("public") && (
						<Filter column={table.getColumn("public")} />
					)}
				</div>
				<div className="w-28">
					{table.getColumn("maxPlayers") && (
						<Filter column={table.getColumn("maxPlayers")} />
					)}
				</div>
				<div className="w-28">
					{table.getColumn("startingStack") && (
						<Filter column={table.getColumn("startingStack")} />
					)}
				</div>
				<div className="w-28">
					{table.getColumn("smallBlind") && (
						<Filter column={table.getColumn("smallBlind")} />
					)}
				</div>
				<div className="w-28">
					{table.getColumn("bigBlind") && (
						<Filter column={table.getColumn("bigBlind")} />
					)}
				</div>
				<div className="w-28">
					{table.getColumn("ante") && (
						<Filter column={table.getColumn("ante")} />
					)}
				</div>
			</div>

			<Table>
				<TableHeader>
					{table.getHeaderGroups().map((headerGroup) => (
						<TableRow key={headerGroup.id} className="bg-muted/50">
							{headerGroup.headers.map((header) => (
								<TableHead
									key={header.id}
									className="relative h-10 select-none border-t"
									aria-sort={
										header.column.getIsSorted() === "asc"
											? "ascending"
											: header.column.getIsSorted() === "desc"
												? "descending"
												: "none"
									}
								>
									{header.isPlaceholder ? null : header.column.getCanSort() ? (
										<div
											className={cn(
												header.column.getCanSort() &&
													"flex h-full cursor-pointer select-none items-center justify-between gap-2",
											)}
											onClick={header.column.getToggleSortingHandler()}
											onKeyDown={(e) => {
												if (
													header.column.getCanSort() &&
													(e.key === "Enter" || e.key === " ")
												) {
													e.preventDefault();
													header.column.getToggleSortingHandler()?.(e);
												}
											}}
											tabIndex={header.column.getCanSort() ? 0 : undefined}
										>
											{flexRender(
												header.column.columnDef.header,
												header.getContext(),
											)}
											{{
												asc: (
													<ChevronUpIcon
														className="shrink-0 opacity-60"
														size={16}
														aria-hidden="true"
													/>
												),
												desc: (
													<ChevronDownIcon
														className="shrink-0 opacity-60"
														size={16}
														aria-hidden="true"
													/>
												),
											}[header.column.getIsSorted() as string] ?? (
												<span className="size-4" aria-hidden="true" />
											)}
										</div>
									) : (
										flexRender(
											header.column.columnDef.header,
											header.getContext(),
										)
									)}
								</TableHead>
							))}
						</TableRow>
					))}
				</TableHeader>
				<TableBody>
					{table.getRowModel().rows?.length ? (
						table.getRowModel().rows.map((row) => (
							<TableRow key={row.id}>
								{row.getVisibleCells().map((cell) => (
									<TableCell key={cell.id}>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</TableCell>
								))}
							</TableRow>
						))
					) : (
						<TableRow>
							<TableCell
								colSpan={columns.length}
								className="h-24 text-center text-muted-foreground"
							>
								No discoverable rooms found.
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>

			{/* Pagination */}
			<div className="flex flex-col items-center justify-center space-y-2">
				<div className="flex w-[100px] items-center justify-center font-medium text-muted-foreground text-sm">
					Page {table.getState().pagination.pageIndex + 1} of{" "}
					{table.getPageCount() || 1}
				</div>
				<div className="flex items-center space-x-2">
					<Button
						variant="outline"
						className="h-8 w-8 p-0"
						onClick={() => table.previousPage()}
						disabled={!table.getCanPreviousPage()}
					>
						<ChevronDownIcon className="h-4 w-4 rotate-90" />
					</Button>
					<Button
						variant="outline"
						className="h-8 w-8 p-0"
						onClick={() => table.nextPage()}
						disabled={!table.getCanNextPage()}
					>
						<ChevronDownIcon className="-rotate-90 h-4 w-4" />
					</Button>
				</div>
			</div>
		</div>
	);
}

function Filter({ column }: { column: Column<RoomData, unknown> | undefined }) {
	if (!column) return null;

	const columnFilterValue = column.getFilterValue();
	const columnHeader =
		typeof column.columnDef.header === "string" ? column.columnDef.header : "";
	const filterVariant = column.columnDef.meta?.filterVariant;

	if (filterVariant === "select") {
		return (
			<div className="*:not-first:mt-2">
				<Label>{columnHeader}</Label>
				<Select
					value={columnFilterValue as string}
					onValueChange={(value) =>
						column.setFilterValue(value === "all" ? "" : value)
					}
				>
					<SelectTrigger>
						<SelectValue placeholder="All" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All</SelectItem>
						<SelectItem value="true">Public</SelectItem>
						<SelectItem value="false">Private</SelectItem>
					</SelectContent>
				</Select>
			</div>
		);
	}

	return (
		<div className="*:not-first:mt-2">
			<Label>{columnHeader}</Label>
			<div className="flex">
				<Input
					className="flex-1 rounded-e-none [-moz-appearance:_textfield] focus:z-10 [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
					value={(columnFilterValue as [number, number])?.[0] ?? ""}
					onChange={(e) =>
						column.setFilterValue((old: [number, number]) => [
							e.target.value ? Number(e.target.value) : undefined,
							old?.[1],
						])
					}
					placeholder="Min"
					type="number"
					aria-label={`${columnHeader} min`}
				/>
				<Input
					className="-ms-px flex-1 rounded-s-none [-moz-appearance:_textfield] focus:z-10 [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
					value={(columnFilterValue as [number, number])?.[1] ?? ""}
					onChange={(e) =>
						column.setFilterValue((old: [number, number]) => [
							old?.[0],
							e.target.value ? Number(e.target.value) : undefined,
						])
					}
					placeholder="Max"
					type="number"
					aria-label={`${columnHeader} max`}
				/>
			</div>
		</div>
	);
}
