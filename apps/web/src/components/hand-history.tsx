import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { GamePhase, Rank, Suit } from "@/types";
import { ChevronLeft, ChevronRight, Expand, Minimize } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { cn } from "../lib/utils";

interface HandHistoryProps {
	history: string[];
	currentPhase: GamePhase;
}

interface ParsedStage {
	name: string;
	lines: React.ReactNode[];
}

const cardRegex = /\b([2-9TJQKA])([CDHS])\b/g;

export const suitMap: Record<Suit, { char: string; colorClass?: string }> = {
	C: { char: "♣", colorClass: "text-green-500 dark:text-green-400" },
	D: { char: "♦", colorClass: "text-blue-500 dark:text-blue-400" },
	H: { char: "♥", colorClass: "text-red-500 dark:text-red-400" },
	S: { char: "♠", colorClass: "text-foreground" },
};

const parseHistoryLine = (line: string): React.ReactNode[] => {
	const parts: React.ReactNode[] = [];
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while (true) {
		match = cardRegex.exec(line);
		if (match === null) break;

		if (match.index > lastIndex) {
			parts.push(line.substring(lastIndex, match.index));
		}
		const rank = match[1] as Rank;
		const suit = match[2] as Suit;
		const suitInfo = suitMap[suit];
		parts.push(
			<span
				key={`${rank}${suit}-${match.index}`}
				className={cn("font-semibold", suitInfo.colorClass)}
				title={`${rank} of ${suit}`}
			>
				{rank}
				{suitInfo.char}
			</span>,
		);
		lastIndex = cardRegex.lastIndex;
	}

	if (lastIndex < line.length) {
		parts.push(line.substring(lastIndex));
	}

	return [<React.Fragment key={line}>{parts}</React.Fragment>];
};

const mapPhaseToStageName = (phase: GamePhase): string => {
	switch (phase) {
		case "preflop":
			return "Preflop";
		case "flop":
			return "Flop";
		case "turn":
			return "Turn";
		case "river":
			return "River";
		case "showdown":
		case "end_hand":
			return "Showdown";
		default:
			return "Preflop";
	}
};

export function HandHistory({ history, currentPhase }: HandHistoryProps) {
	const [activeTab, setActiveTab] = useState<string>("Preflop");
	const [isExpanded, setIsExpanded] = useState(false);
	const [currentMessageIndex, setCurrentMessageIndex] = useState<
		Record<string, number>
	>({});

	const parsedHistory = useMemo((): ParsedStage[] => {
		const stages: ParsedStage[] = [
			{ name: "Preflop", lines: [] },
			{ name: "Flop", lines: [] },
			{ name: "Turn", lines: [] },
			{ name: "River", lines: [] },
			{ name: "Showdown", lines: [] },
		];
		let currentStageIndex = 0;

		for (const line of history) {
			if (line === "--- Hand End ---") {
				continue;
			}

			const parsedLineNodes = parseHistoryLine(line);

			if (line.startsWith("Flop dealt:")) {
				currentStageIndex = 1;
			} else if (line.startsWith("Turn dealt:")) {
				currentStageIndex = 2;
			} else if (line.startsWith("River dealt:")) {
				currentStageIndex = 3;
			} else if (
				line.startsWith("--- Showdown ---") ||
				line.startsWith("--- Pot Distribution ---")
			) {
				currentStageIndex = 4;
			}

			if (currentStageIndex >= 0 && currentStageIndex < stages.length) {
				stages[currentStageIndex].lines.push(...parsedLineNodes);
			} else {
				stages[stages.length - 1].lines.push(...parsedLineNodes);
			}
		}

		const nonEmptyStages = stages.filter(
			(stage, index) => stage.lines.length > 0 || index === 0,
		);

		if (!nonEmptyStages.some((s) => s.name === "Preflop")) {
			return [{ name: "Preflop", lines: [] }, ...nonEmptyStages];
		}

		return nonEmptyStages;
	}, [history]);

	useEffect(() => {
		const targetStage = mapPhaseToStageName(currentPhase);
		if (parsedHistory.some((stage) => stage.name === targetStage)) {
			setActiveTab(targetStage);
			const stage = parsedHistory.find((s) => s.name === targetStage);
			if (stage) {
				setCurrentMessageIndex((prev) => ({
					...prev,
					[targetStage]: stage.lines.length - 1,
				}));
			}
		} else if (parsedHistory.length > 0) {
			const lastStage = parsedHistory[parsedHistory.length - 1];
			setActiveTab(lastStage.name);
			setCurrentMessageIndex((prev) => ({
				...prev,
				[lastStage.name]: lastStage.lines.length - 1,
			}));
		}
	}, [currentPhase, parsedHistory]);

	if (!history || history.length === 0) {
		return (
			<div className="rounded-lg border p-4 text-center text-muted-foreground text-sm">
				No hand history yet.
			</div>
		);
	}

	const currentStage = parsedHistory.find((stage) => stage.name === activeTab);
	const currentIndex = currentMessageIndex[activeTab] || 0;

	const handlePrevMessage = () => {
		if (currentStage && currentIndex > 0) {
			setCurrentMessageIndex((prev) => ({
				...prev,
				[activeTab]: currentIndex - 1,
			}));
		}
	};

	const handleNextMessage = () => {
		if (currentStage && currentIndex < currentStage.lines.length - 1) {
			setCurrentMessageIndex((prev) => ({
				...prev,
				[activeTab]: currentIndex + 1,
			}));
		}
	};

	return (
		<div className="w-full">
			<div className="mb-2 flex justify-end">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setIsExpanded(!isExpanded)}
					className="h-8 px-2"
				>
					{isExpanded ? (
						<Minimize className="h-4 w-4" />
					) : (
						<Expand className="h-4 w-4" />
					)}
				</Button>
			</div>
			<Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
				<TabsList className="grid w-full grid-cols-5">
					{parsedHistory.map((stage) => (
						<TabsTrigger key={stage.name} value={stage.name}>
							{stage.name}
						</TabsTrigger>
					))}
				</TabsList>
				{parsedHistory.map((stage) => (
					<TabsContent key={stage.name} value={stage.name}>
						{isExpanded ? (
							<ScrollArea className="h-96 w-full rounded-md border p-4 text-center">
								{stage.lines.map((line, index) => (
									<div key={index} className="mb-2">
										{line}
									</div>
								))}
							</ScrollArea>
						) : (
							<div className="flex flex-col rounded-md border p-4">
								<div className="min-h-[2rem] flex-1 text-center">
									{currentStage?.lines[currentIndex]}
								</div>
								<div className="mt-2 flex items-center justify-between border-t pt-2">
									<Button
										variant="outline"
										size="sm"
										onClick={handlePrevMessage}
										disabled={currentIndex === 0}
									>
										<ChevronLeft className="h-4 w-4" />
									</Button>
									<span className="text-muted-foreground text-sm">
										{currentIndex + 1} / {currentStage?.lines.length}
									</span>
									<Button
										variant="outline"
										size="sm"
										onClick={handleNextMessage}
										disabled={
											currentStage &&
											currentIndex === currentStage.lines.length - 1
										}
									>
										<ChevronRight className="h-4 w-4" />
									</Button>
								</div>
							</div>
						)}
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
