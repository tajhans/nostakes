import type { Rank, Suit } from "./game";

export interface CardComponentProps {
	rank: Rank;
	suit: Suit;
	size?: "sm" | "md" | "lg";
}
