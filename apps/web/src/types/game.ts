export type Suit = "C" | "D" | "H" | "S";
export type Rank =
	| "2"
	| "3"
	| "4"
	| "5"
	| "6"
	| "7"
	| "8"
	| "9"
	| "T"
	| "J"
	| "Q"
	| "K"
	| "A";

export interface Card {
	rank: Rank;
	suit: Suit;
}

export type GamePhase =
	| "waiting"
	| "preflop"
	| "flop"
	| "turn"
	| "river"
	| "showdown"
	| "end_hand";

export interface PlayerState {
	userId: string;
	seatNumber: number;
	stack: number;
	hand: Card[];
	currentBet: number;
	totalBet: number;
	hasActed: boolean;
	isFolded: boolean;
	isAllIn: boolean;
	isSittingOut: boolean;
}

export interface GameState {
	roomId: string;
	phase: GamePhase;
	communityCards: Card[];
	pot: number;
	currentBet: number;
	minRaiseAmount: number;
	dealerSeat: number;
	smallBlindSeat: number;
	bigBlindSeat: number;
	currentPlayerSeat: number | null;
	lastActionPlayerSeat: number | null;
	playerStates: Record<string, PlayerState>;
	handHistory: string[];
	lastUpdateTime: number;
	roomConfig: { smallBlind: number; bigBlind: number; ante: number };
}
