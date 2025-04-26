import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { GamePhase, Rank, Suit } from "@/routes/room";
import React, { useEffect, useMemo, useState } from "react";
import { cn } from "../lib/utils";

interface CardComponentProps {
	rank: Rank;
	suit: Suit;
	size?: "sm" | "md" | "lg";
}

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
			const parsedLineNodes = parseHistoryLine(line);

			if (line.startsWith("Flop dealt:")) {
				currentStageIndex = 1;
			} else if (line.startsWith("Turn dealt:")) {
				currentStageIndex = 2;
			} else if (line.startsWith("River dealt:")) {
				currentStageIndex = 3;
			} else if (
				line.startsWith("--- Showdown ---") ||
				line.startsWith("--- Pot Distribution ---") ||
				line.startsWith("--- Hand End ---")
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
		} else if (parsedHistory.length > 0) {
			setActiveTab(parsedHistory[parsedHistory.length - 1].name);
		}
	}, [currentPhase, parsedHistory]);

	if (!history || history.length === 0) {
		return (
			<div className="rounded-lg border p-4 text-center text-muted-foreground text-sm">
				No hand history yet.
			</div>
		);
	}

	return (
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
					<ScrollArea className="h-96 w-full rounded-md border p-4">
						{stage.lines.map((line, index) => (
							<div key={index} className="mb-2">
								{line}
							</div>
						))}
					</ScrollArea>
				</TabsContent>
			))}
		</Tabs>
	);
}
