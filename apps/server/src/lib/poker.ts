import { produce } from "immer";
import type { RoomMemberInfo } from "./redis";

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

export const SUITS: Suit[] = ["C", "D", "H", "S"];
export const RANKS: Rank[] = [
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9",
	"T",
	"J",
	"Q",
	"K",
	"A",
];
const RANK_VALUES: Record<Rank, number> = {
	"2": 2,
	"3": 3,
	"4": 4,
	"5": 5,
	"6": 6,
	"7": 7,
	"8": 8,
	"9": 9,
	T: 10,
	J: 11,
	Q: 12,
	K: 13,
	A: 14,
};

export function createDeck(): Card[] {
	const deck: Card[] = [];
	for (const suit of SUITS) {
		for (const rank of RANKS) {
			deck.push({ suit, rank });
		}
	}
	return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
	let currentIndex = deck.length;
	let randomIndex: number;

	while (currentIndex !== 0) {
		randomIndex = Math.floor(Math.random() * currentIndex);
		currentIndex--;

		[deck[currentIndex], deck[randomIndex]] = [
			deck[randomIndex],
			deck[currentIndex],
		];
	}

	return deck;
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
	deck: Card[];
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

export type ClientPokerAction =
	| { type: "action"; action: "fold" }
	| { type: "action"; action: "check" }
	| { type: "action"; action: "call" }
	| { type: "action"; action: "bet"; amount: number }
	| { type: "action"; action: "raise"; amount: number };

function initializePlayerStateForHand(
	member: RoomMemberInfo,
	seatNumber: number,
	stack: number,
): PlayerState {
	return {
		userId: member.userId,
		seatNumber: seatNumber,
		stack: stack,
		hand: [],
		currentBet: 0,
		totalBet: 0,
		hasActed: false,
		isFolded: false,
		isAllIn: false,
		isSittingOut: false,
	};
}

export async function startNewHand(
	roomId: string,
	roomConfig: { smallBlind: number; bigBlind: number; ante: number },
	currentMembers: RoomMemberInfo[],
	previousGameState?: GameState | null,
): Promise<GameState> {
	const activeRoomMembers = currentMembers.filter((m) => m.isActive);
	if (activeRoomMembers.length < 2) {
		throw new Error("Not enough active players in the room (minimum 2).");
	}

	const participatingMembers = activeRoomMembers.filter(
		(m) => m.wantsToPlayNextHand === true,
	);

	if (participatingMembers.length < 2) {
		throw new Error(
			`Not enough players want to play the next hand (minimum 2). Found ${participatingMembers.length}.`,
		);
	}

	const shuffledDeck = shuffleDeck(createDeck());
	const communityCards: Card[] = [];
	let currentPot = 0;

	let dealerSeat: number;
	const sortedParticipatingSeats = participatingMembers
		.map((p) => p.seatNumber)
		.sort((a, b) => a - b);

	if (previousGameState?.dealerSeat) {
		const currentDealerIndex = sortedParticipatingSeats.indexOf(
			previousGameState.dealerSeat,
		);
		if (currentDealerIndex === -1) {
			let nextSeat = sortedParticipatingSeats[0];
			for (const seat of sortedParticipatingSeats) {
				if (seat > previousGameState.dealerSeat) {
					nextSeat = seat;
					break;
				}
			}
			dealerSeat = nextSeat;
		} else {
			const nextDealerIndex =
				(currentDealerIndex + 1) % sortedParticipatingSeats.length;
			dealerSeat = sortedParticipatingSeats[nextDealerIndex];
		}
	} else {
		dealerSeat = sortedParticipatingSeats[0];
	}

	const findNextParticipatingSeat = (startSeat: number): number => {
		const startIndex = sortedParticipatingSeats.indexOf(startSeat);
		if (startIndex === -1) {
			let nextSeat = sortedParticipatingSeats[0];
			for (const seat of sortedParticipatingSeats) {
				if (seat > startSeat) {
					nextSeat = seat;
					break;
				}
			}
			return nextSeat;
		}
		const nextIndex = (startIndex + 1) % sortedParticipatingSeats.length;
		return sortedParticipatingSeats[nextIndex];
	};

	const smallBlindSeat = findNextParticipatingSeat(dealerSeat);
	const bigBlindSeat =
		participatingMembers.length > 2
			? findNextParticipatingSeat(smallBlindSeat)
			: dealerSeat;

	const playerStates: Record<string, PlayerState> = {};
	for (const member of participatingMembers) {
		const prevPlayerState = previousGameState?.playerStates[member.userId];
		const startingStack = prevPlayerState
			? prevPlayerState.stack
			: member.currentStack > 0
				? member.currentStack
				: roomConfig.bigBlind * 50;

		playerStates[member.userId] = initializePlayerStateForHand(
			member,
			member.seatNumber,
			startingStack,
		);
	}

	const sittingOutMembers = activeRoomMembers.filter(
		(m) => !participatingMembers.some((p) => p.userId === m.userId),
	);
	for (const member of sittingOutMembers) {
		const prevPlayerState = previousGameState?.playerStates[member.userId];
		const stack = prevPlayerState ? prevPlayerState.stack : member.currentStack;
		playerStates[member.userId] = {
			...initializePlayerStateForHand(member, member.seatNumber, stack),
			isSittingOut: true,
		};
	}

	const handHistory: string[] = [`Hand started. Dealer is Seat ${dealerSeat}.`];

	if (roomConfig.ante > 0) {
		handHistory.push(`Posting ${roomConfig.ante} ante.`);
		for (const player of Object.values(playerStates)) {
			if (!player.isSittingOut) {
				const anteAmount = Math.min(player.stack, roomConfig.ante);
				if (anteAmount > 0) {
					player.stack -= anteAmount;
					player.totalBet += anteAmount;
					currentPot += anteAmount;
					handHistory.push(
						`Seat ${player.seatNumber} posts ante of ${anteAmount}${player.stack === 0 ? " (ALL-IN)" : ""}.`,
					);
					if (player.stack === 0) {
						player.isAllIn = true;
					}
				}
			}
		}
	}

	const sbPlayer = Object.values(playerStates).find(
		(p) => p.seatNumber === smallBlindSeat && !p.isSittingOut,
	);
	const bbPlayer = Object.values(playerStates).find(
		(p) => p.seatNumber === bigBlindSeat && !p.isSittingOut,
	);

	if (sbPlayer) {
		const blindAmount = Math.min(sbPlayer.stack, roomConfig.smallBlind);
		sbPlayer.stack -= blindAmount;
		sbPlayer.currentBet = blindAmount;
		sbPlayer.totalBet += blindAmount;
		currentPot += blindAmount;
		handHistory.push(
			`Seat ${sbPlayer.seatNumber} posts small blind of ${blindAmount}${sbPlayer.stack === 0 ? " (ALL-IN)" : ""}.`,
		);
		if (sbPlayer.stack === 0) sbPlayer.isAllIn = true;
	} else {
		handHistory.push(
			`Seat ${smallBlindSeat} did not participate or couldn't post SB.`,
		);
	}

	if (bbPlayer) {
		const blindAmount = Math.min(bbPlayer.stack, roomConfig.bigBlind);
		bbPlayer.stack -= blindAmount;
		bbPlayer.currentBet = Math.max(bbPlayer.currentBet, blindAmount);
		bbPlayer.totalBet += blindAmount;
		currentPot += blindAmount;
		handHistory.push(
			`Seat ${bbPlayer.seatNumber} posts big blind of ${blindAmount}${bbPlayer.stack === 0 ? " (ALL-IN)" : ""}.`,
		);
		if (bbPlayer.stack === 0) bbPlayer.isAllIn = true;
	} else {
		handHistory.push(
			`Seat ${bigBlindSeat} did not participate or couldn't post BB.`,
		);
	}

	const initialGameState: GameState = {
		roomId,
		phase: "preflop",
		deck: shuffledDeck,
		communityCards,
		pot: currentPot,
		currentBet: roomConfig.bigBlind,
		minRaiseAmount: roomConfig.bigBlind,
		dealerSeat,
		smallBlindSeat,
		bigBlindSeat,
		currentPlayerSeat: null,
		lastActionPlayerSeat: bigBlindSeat,
		playerStates: playerStates,
		handHistory: handHistory,
		lastUpdateTime: Date.now(),
		roomConfig: roomConfig,
	};

	const participatingSeatsDealingOrder = Object.values(
		initialGameState.playerStates,
	)
		.filter((p) => !p.isSittingOut)
		.sort((a, b) => {
			const maxSeats = Math.max(...currentMembers.map((m) => m.seatNumber), 10);
			const aRel = (a.seatNumber - dealerSeat + maxSeats) % maxSeats;
			const bRel = (b.seatNumber - dealerSeat + maxSeats) % maxSeats;
			return aRel - bRel;
		})
		.map((p) => p.userId);

	for (let i = 0; i < 2; i++) {
		for (const userId of participatingSeatsDealingOrder) {
			const card = initialGameState.deck.pop();
			if (card) {
				initialGameState.playerStates[userId].hand.push(card);
			} else {
				throw new Error("Deck ran out of cards while dealing hole cards.");
			}
		}
	}
	initialGameState.handHistory.push("Hole cards dealt to participants.");

	initialGameState.currentPlayerSeat =
		getNextActivePlayerSeat(initialGameState, bigBlindSeat) ?? null;

	while (initialGameState.currentPlayerSeat) {
		const currentPlayerUserId = Object.keys(initialGameState.playerStates).find(
			(uid) =>
				initialGameState.playerStates[uid].seatNumber ===
				initialGameState.currentPlayerSeat,
		);
		if (
			currentPlayerUserId &&
			initialGameState.playerStates[currentPlayerUserId]?.isAllIn
		) {
			const currentSeat = initialGameState.currentPlayerSeat;
			const nextSeat = getNextActivePlayerSeat(initialGameState, currentSeat);

			if (
				nextSeat === null ||
				nextSeat === initialGameState.lastActionPlayerSeat ||
				nextSeat === currentSeat
			) {
				initialGameState.currentPlayerSeat = null;
				break;
			}

			initialGameState.currentPlayerSeat = nextSeat;
		} else {
			break;
		}
	}

	if (initialGameState.currentPlayerSeat) {
		initialGameState.handHistory.push(
			`Seat ${initialGameState.currentPlayerSeat} is first to act.`,
		);
	} else {
		initialGameState.handHistory.push(
			"No player able to act preflop. Proceeding to deal board or showdown.",
		);
	}

	for (const p of Object.values(initialGameState.playerStates)) {
		if (!p.isAllIn && !p.isSittingOut) {
			p.hasActed = false;
		}
	}

	return initialGameState;
}

enum HandRank {
	HIGH_CARD = 1,
	PAIR = 2,
	TWO_PAIR = 3,
	THREE_OF_A_KIND = 4,
	STRAIGHT = 5,
	FLUSH = 6,
	FULL_HOUSE = 7,
	FOUR_OF_A_KIND = 8,
	STRAIGHT_FLUSH = 9,
	ROYAL_FLUSH = 10,
}

const HAND_RANK_NAMES: Record<HandRank, string> = {
	[HandRank.HIGH_CARD]: "High Card",
	[HandRank.PAIR]: "Pair",
	[HandRank.TWO_PAIR]: "Two Pair",
	[HandRank.THREE_OF_A_KIND]: "Three of a Kind",
	[HandRank.STRAIGHT]: "Straight",
	[HandRank.FLUSH]: "Flush",
	[HandRank.FULL_HOUSE]: "Full House",
	[HandRank.FOUR_OF_A_KIND]: "Four of a Kind",
	[HandRank.STRAIGHT_FLUSH]: "Straight Flush",
	[HandRank.ROYAL_FLUSH]: "Royal Flush",
};

interface HandEvaluationResult {
	rankValue: HandRank;
	rankName: string;
	bestHand: Card[];
	kickers: number[];
}

function getCombinations(cards: Card[], k: number): Card[][] {
	if (k < 0 || k > cards.length) {
		return [];
	}
	if (k === 0) {
		return [[]];
	}
	if (k === cards.length) {
		return [cards];
	}
	const [first, ...rest] = cards;
	const combsWithFirst = getCombinations(rest, k - 1).map((comb) => [
		first,
		...comb,
	]);
	const combsWithoutFirst = getCombinations(rest, k);
	return [...combsWithFirst, ...combsWithoutFirst];
}

function sortCards(cards: Card[]): Card[] {
	return [...cards].sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank]);
}

export function evaluateHand(
	holeCards: Card[],
	communityCards: Card[],
): HandEvaluationResult {
	const allCards = [...holeCards, ...communityCards];
	if (allCards.length < 5) {
		console.warn(
			`Attempted to evaluate hand with only ${allCards.length} cards.`,
		);
		return {
			rankValue: HandRank.HIGH_CARD,
			rankName: "Invalid Hand (< 5 cards)",
			bestHand: sortCards(allCards).slice(0, 5),
			kickers: sortCards(allCards)
				.slice(0, 5)
				.map((c) => RANK_VALUES[c.rank]),
		};
	}

	const possibleHands =
		allCards.length > 5 ? getCombinations(allCards, 5) : [allCards];

	let bestResult: HandEvaluationResult = {
		rankValue: HandRank.HIGH_CARD,
		rankName: "High Card",
		bestHand: [],
		kickers: [],
	};

	for (const hand of possibleHands) {
		const currentResult = evaluateFiveCardHand(hand);
		if (
			currentResult.rankValue > bestResult.rankValue ||
			(currentResult.rankValue === bestResult.rankValue &&
				compareKickers(currentResult.kickers, bestResult.kickers) > 0) ||
			bestResult.bestHand.length === 0
		) {
			bestResult = currentResult;
		}
	}

	if (bestResult.bestHand.length === 0 && possibleHands.length > 0) {
		const firstHandSorted = sortCards(possibleHands[0]);
		bestResult = {
			rankValue: HandRank.HIGH_CARD,
			rankName: HAND_RANK_NAMES[HandRank.HIGH_CARD],
			bestHand: firstHandSorted.slice(0, 5),
			kickers: firstHandSorted.slice(0, 5).map((c) => RANK_VALUES[c.rank]),
		};
	}

	return bestResult;
}

function evaluateFiveCardHand(hand: Card[]): HandEvaluationResult {
	if (hand.length !== 5) {
		console.error(
			"evaluateFiveCardHand called with incorrect number of cards:",
			hand.length,
		);
		return {
			rankValue: HandRank.HIGH_CARD,
			rankName: "Invalid Hand",
			bestHand: [],
			kickers: [],
		};
	}

	const sortedHand = sortCards(hand);
	const ranks = sortedHand.map((c) => RANK_VALUES[c.rank]);
	const suits = sortedHand.map((c) => c.suit);
	const isFlush = new Set(suits).size === 1;
	const rankCounts = ranks.reduce(
		(acc, rank) => {
			acc[rank] = (acc[rank] || 0) + 1;
			return acc;
		},
		{} as Record<number, number>,
	);
	const counts = Object.values(rankCounts).sort((a, b) => b - a);
	const uniqueRanksSorted = [...new Set(ranks)].sort((a, b) => b - a);

	let isStraight = false;
	let straightHighCard = -1;
	if (uniqueRanksSorted.length === 5) {
		if (uniqueRanksSorted[0] - uniqueRanksSorted[4] === 4) {
			isStraight = true;
			straightHighCard = uniqueRanksSorted[0];
		}
	}
	const isAceLowStraight =
		uniqueRanksSorted.length === 5 &&
		uniqueRanksSorted[0] === 14 &&
		uniqueRanksSorted[1] === 5 &&
		uniqueRanksSorted[2] === 4 &&
		uniqueRanksSorted[3] === 3 &&
		uniqueRanksSorted[4] === 2;

	if (isAceLowStraight) {
		isStraight = true;
		straightHighCard = 5;
		const ace = sortedHand.find((c) => RANK_VALUES[c.rank] === 14);
		if (!ace) {
			throw new Error(
				"Internal Error: Ace not found in detected Ace-low straight.",
			);
		}
		const lowCards = sortedHand.filter((c) => RANK_VALUES[c.rank] <= 5);
		sortedHand.splice(0, sortedHand.length, ...lowCards, ace);
	}

	if (isFlush && isStraight) {
		const rank =
			straightHighCard === 14 && !isAceLowStraight
				? HandRank.ROYAL_FLUSH
				: HandRank.STRAIGHT_FLUSH;
		return {
			rankValue: rank,
			rankName: HAND_RANK_NAMES[rank],
			bestHand: sortedHand,
			kickers: [straightHighCard],
		};
	}

	if (counts[0] === 4) {
		const fourRank = uniqueRanksSorted.find((r) => rankCounts[r] === 4);
		if (fourRank === undefined) {
			throw new Error(
				"Internal Error: Four-of-a-kind rank not found when expected.",
			);
		}

		const kicker = uniqueRanksSorted.find((r) => r !== fourRank);
		if (kicker === undefined) {
			throw new Error(
				"Internal Error: Kicker rank not found for four-of-a-kind.",
			);
		}

		const fourCards = sortedHand.filter(
			(c) => RANK_VALUES[c.rank] === fourRank,
		);

		const kickerCard = sortedHand.find((c) => RANK_VALUES[c.rank] === kicker);
		if (!kickerCard) {
			throw new Error(
				"Internal Error: Kicker card not found for four-of-a-kind.",
			);
		}
		return {
			rankValue: HandRank.FOUR_OF_A_KIND,
			rankName: HAND_RANK_NAMES[HandRank.FOUR_OF_A_KIND],
			bestHand: [...fourCards, kickerCard],
			kickers: [fourRank, kicker],
		};
	}

	if (counts[0] === 3 && counts[1] === 2) {
		const threeRank = uniqueRanksSorted.find((r) => rankCounts[r] === 3);
		if (threeRank === undefined) {
			throw new Error(
				"Internal Error: Three-of-a-kind rank not found for full house.",
			);
		}

		const pairRank = uniqueRanksSorted.find((r) => rankCounts[r] === 2);
		if (pairRank === undefined) {
			throw new Error("Internal Error: Pair rank not found for full house.");
		}

		const threeCards = sortedHand.filter(
			(c) => RANK_VALUES[c.rank] === threeRank,
		);
		const pairCards = sortedHand.filter(
			(c) => RANK_VALUES[c.rank] === pairRank,
		);
		return {
			rankValue: HandRank.FULL_HOUSE,
			rankName: HAND_RANK_NAMES[HandRank.FULL_HOUSE],
			bestHand: [...threeCards, ...pairCards],
			kickers: [threeRank, pairRank],
		};
	}

	if (isFlush) {
		return {
			rankValue: HandRank.FLUSH,
			rankName: HAND_RANK_NAMES[HandRank.FLUSH],
			bestHand: sortedHand,
			kickers: ranks,
		};
	}

	if (isStraight) {
		return {
			rankValue: HandRank.STRAIGHT,
			rankName: HAND_RANK_NAMES[HandRank.STRAIGHT],
			bestHand: sortedHand,
			kickers: [straightHighCard],
		};
	}

	if (counts[0] === 3) {
		const threeRank = uniqueRanksSorted.find((r) => rankCounts[r] === 3);
		if (threeRank === undefined) {
			throw new Error(
				"Internal Error: Three-of-a-kind rank not found when expected.",
			);
		}
		const kickers = uniqueRanksSorted
			.filter((r) => r !== threeRank)
			.slice(0, 2);
		const threeCards = sortedHand.filter(
			(c) => RANK_VALUES[c.rank] === threeRank,
		);
		const kickerCards = sortedHand.filter((c) =>
			kickers.includes(RANK_VALUES[c.rank]),
		);
		if (kickerCards.length !== 2) {
			console.warn(
				"Incorrect number of kicker cards found for Three of a Kind",
				{ threeRank, kickers, kickerCards, sortedHand },
			);
		}
		return {
			rankValue: HandRank.THREE_OF_A_KIND,
			rankName: HAND_RANK_NAMES[HandRank.THREE_OF_A_KIND],
			bestHand: [...threeCards, ...kickerCards].slice(0, 5),
			kickers: [threeRank, ...kickers],
		};
	}

	if (counts[0] === 2 && counts[1] === 2) {
		const pairs = uniqueRanksSorted
			.filter((r) => rankCounts[r] === 2)
			.slice(0, 2);
		const kicker = uniqueRanksSorted.find((r) => !pairs.includes(r));
		if (kicker === undefined) {
			throw new Error("Internal Error: Kicker rank not found for two pair.");
		}
		const highPairCards = sortedHand.filter(
			(c) => RANK_VALUES[c.rank] === pairs[0],
		);
		const lowPairCards = sortedHand.filter(
			(c) => RANK_VALUES[c.rank] === pairs[1],
		);
		const kickerCard = sortedHand.find((c) => RANK_VALUES[c.rank] === kicker);
		if (!kickerCard) {
			throw new Error("Internal Error: Kicker card not found for two pair.");
		}
		return {
			rankValue: HandRank.TWO_PAIR,
			rankName: HAND_RANK_NAMES[HandRank.TWO_PAIR],
			bestHand: [...highPairCards, ...lowPairCards, kickerCard],
			kickers: [...pairs, kicker],
		};
	}

	if (counts[0] === 2) {
		const pairRank = uniqueRanksSorted.find((r) => rankCounts[r] === 2);
		if (pairRank === undefined) {
			throw new Error("Internal Error: Pair rank not found when expected.");
		}
		const kickers = uniqueRanksSorted.filter((r) => r !== pairRank).slice(0, 3);
		const pairCards = sortedHand.filter(
			(c) => RANK_VALUES[c.rank] === pairRank,
		);
		const kickerCards = sortedHand.filter((c) =>
			kickers.includes(RANK_VALUES[c.rank]),
		);
		if (kickerCards.length !== 3) {
			console.warn("Incorrect number of kicker cards found for Pair", {
				pairRank,
				kickers,
				kickerCards,
				sortedHand,
			});
		}
		return {
			rankValue: HandRank.PAIR,
			rankName: HAND_RANK_NAMES[HandRank.PAIR],
			bestHand: [...pairCards, ...kickerCards].slice(0, 5),
			kickers: [pairRank, ...kickers],
		};
	}

	return {
		rankValue: HandRank.HIGH_CARD,
		rankName: HAND_RANK_NAMES[HandRank.HIGH_CARD],
		bestHand: sortedHand,
		kickers: ranks,
	};
}

function compareKickers(kickersA: number[], kickersB: number[]): number {
	for (let i = 0; i < Math.min(kickersA.length, kickersB.length); i++) {
		if (kickersA[i] !== kickersB[i]) {
			return kickersA[i] - kickersB[i];
		}
	}
	return 0;
}

export function getNextActivePlayerSeat(
	currentState: GameState,
	startSeat: number,
): number | null {
	const playerSeats = Object.values(currentState.playerStates)
		.filter((p) => !p.isFolded && !p.isAllIn && !p.isSittingOut)
		.map((p) => p.seatNumber)
		.sort((a, b) => a - b);

	if (playerSeats.length === 0) {
		return null;
	}

	const maxSeats = Math.max(
		...Object.values(currentState.playerStates).map((p) => p.seatNumber),
		10,
	);

	let currentSeat = startSeat;
	for (let i = 0; i < maxSeats; i++) {
		currentSeat = (currentSeat % maxSeats) + 1;
		const playerAtSeat = Object.values(currentState.playerStates).find(
			(p) => p.seatNumber === currentSeat,
		);
		if (
			playerAtSeat &&
			!playerAtSeat.isFolded &&
			!playerAtSeat.isAllIn &&
			!playerAtSeat.isSittingOut
		) {
			return currentSeat;
		}
	}

	return null;
}

export function getFirstToActSeat(currentState: GameState): number | null {
	if (currentState.phase === "preflop") {
		console.warn(
			"getFirstToActSeat called during preflop, use initial currentPlayerSeat.",
		);
		return currentState.currentPlayerSeat;
	}

	const dealerSeat = currentState.dealerSeat;
	return getNextActivePlayerSeat(currentState, dealerSeat);
}

function validateAction(
	gameState: GameState,
	userId: string,
	action: ClientPokerAction["action"],
	amount?: number,
): { isValid: boolean; message: string; playerState?: PlayerState } {
	const playerState = gameState.playerStates[userId];

	if (!playerState) {
		return {
			isValid: false,
			message: "Player not participating in this hand.",
		};
	}
	if (gameState.currentPlayerSeat !== playerState.seatNumber) {
		return { isValid: false, message: "Not your turn." };
	}
	if (playerState.isFolded || playerState.isAllIn || playerState.isSittingOut) {
		return { isValid: false, message: "Player cannot act." };
	}

	const currentBet = gameState.currentBet;
	const playerCurrentBet = playerState.currentBet;
	const playerStack = playerState.stack;

	switch (action) {
		case "fold":
			return { isValid: true, message: "", playerState };
		case "check":
			if (playerCurrentBet < currentBet) {
				if (
					gameState.phase === "preflop" &&
					playerState.seatNumber === gameState.bigBlindSeat &&
					playerCurrentBet === currentBet
				) {
					return { isValid: true, message: "", playerState };
				}
				return {
					isValid: false,
					message: `Cannot check, must call ${currentBet - playerCurrentBet} or raise.`,
				};
			}
			return { isValid: true, message: "", playerState };
		case "call":
			if (playerCurrentBet >= currentBet) {
				if (currentBet === 0) {
					return { isValid: false, message: "Cannot call 0, use check." };
				}
				if (
					gameState.phase === "preflop" &&
					playerState.seatNumber === gameState.bigBlindSeat &&
					playerCurrentBet === currentBet
				) {
					return {
						isValid: false,
						message: "Use check instead of calling (BB option).",
					};
				}
				return {
					isValid: false,
					message: "Already met or exceeded the current bet.",
				};
			}
			return { isValid: true, message: "", playerState };
		case "bet": {
			if (currentBet > 0) {
				return { isValid: false, message: "Cannot bet, must raise." };
			}
			if (amount === undefined || amount <= 0) {
				return { isValid: false, message: "Invalid bet amount." };
			}
			const minBetAmount = Math.min(gameState.roomConfig.bigBlind, playerStack);
			if (amount < minBetAmount && playerStack > amount) {
				return {
					isValid: false,
					message: `Minimum bet is ${minBetAmount}.`,
				};
			}
			if (amount > playerStack) {
				if (amount !== playerStack) {
					return { isValid: false, message: "Bet amount exceeds stack." };
				}
			}
			return { isValid: true, message: "", playerState };
		}
		case "raise": {
			if (currentBet === 0) {
				return { isValid: false, message: "Cannot raise, use bet." };
			}
			if (amount === undefined || amount <= 0) {
				return { isValid: false, message: "Invalid raise amount." };
			}

			const totalNewBet = amount;
			const amountToAdd = totalNewBet - playerCurrentBet;

			if (amountToAdd <= 0) {
				return {
					isValid: false,
					message: "Raise must result in a higher total bet for the round.",
				};
			}

			if (totalNewBet <= currentBet) {
				return {
					isValid: false,
					message: `Must raise to more than the current bet of ${currentBet}.`,
				};
			}

			const raiseIncrease = totalNewBet - currentBet;
			const requiredTotalBet = currentBet + gameState.minRaiseAmount;

			if (
				raiseIncrease < gameState.minRaiseAmount &&
				amountToAdd < playerStack
			) {
				return {
					isValid: false,
					message: `Minimum raise increase is ${gameState.minRaiseAmount}, making the total bet at least ${requiredTotalBet}.`,
				};
			}

			if (amountToAdd > playerStack) {
				if (totalNewBet !== playerStack + playerCurrentBet) {
					return {
						isValid: false,
						message: "Raise amount exceeds stack.",
					};
				}
			}

			return { isValid: true, message: "", playerState };
		}
		default: {
			const _exhaustiveCheck: never = action;

			return { isValid: false, message: "Unknown action." };
		}
	}
}

function applyAction(
	gameState: GameState,
	playerState: PlayerState,
	action: ClientPokerAction["action"],
	amount?: number,
): GameState {
	return produce(gameState, (draft) => {
		const actingPlayer = draft.playerStates[playerState.userId];
		if (!actingPlayer) {
			console.error(
				"Acting player not found in draft state during applyAction",
			);
			return;
		}

		actingPlayer.hasActed = true;
		draft.lastActionPlayerSeat = actingPlayer.seatNumber;

		let actionDesc = "";
		const playerSeat = actingPlayer.seatNumber;
		const currentBetLevel = draft.currentBet;

		switch (action) {
			case "fold":
				actingPlayer.isFolded = true;
				actionDesc = `Seat ${playerSeat} folds.`;
				break;
			case "check":
				if (
					draft.phase === "preflop" &&
					actingPlayer.seatNumber === draft.bigBlindSeat &&
					actingPlayer.currentBet === currentBetLevel
				) {
					actionDesc = `Seat ${playerSeat} checks (BB option).`;
				} else {
					actionDesc = `Seat ${playerSeat} checks.`;
				}
				break;
			case "call": {
				const amountToCall = Math.min(
					currentBetLevel - actingPlayer.currentBet,
					actingPlayer.stack,
				);
				actingPlayer.stack -= amountToCall;
				actingPlayer.currentBet += amountToCall;
				actingPlayer.totalBet += amountToCall;
				draft.pot += amountToCall;
				actionDesc = `Seat ${playerSeat} calls ${amountToCall}.`;
				if (actingPlayer.stack === 0) {
					actingPlayer.isAllIn = true;
					actionDesc += " (ALL-IN)";
				}
				break;
			}
			case "bet": {
				const validBetAmount = amount !== undefined && amount > 0 ? amount : 0;
				const betAmountValue = Math.min(validBetAmount, actingPlayer.stack);

				actingPlayer.stack -= betAmountValue;
				actingPlayer.currentBet = betAmountValue;
				actingPlayer.totalBet += betAmountValue;
				draft.pot += betAmountValue;
				draft.currentBet = betAmountValue;
				draft.minRaiseAmount = betAmountValue;
				actionDesc = `Seat ${playerSeat} bets ${betAmountValue}.`;
				if (actingPlayer.stack === 0) {
					actingPlayer.isAllIn = true;
					actionDesc += " (ALL-IN)";
				}
				for (const p of Object.values(draft.playerStates)) {
					if (
						p.userId !== actingPlayer.userId &&
						!p.isAllIn &&
						!p.isFolded &&
						!p.isSittingOut
					) {
						p.hasActed = false;
					}
				}
				break;
			}
			case "raise": {
				const validRaiseAmount =
					amount !== undefined && amount > 0 ? amount : 0;
				const targetRaiseTotal = Math.min(
					validRaiseAmount,
					actingPlayer.stack + actingPlayer.currentBet,
				);
				const amountAdded = targetRaiseTotal - actingPlayer.currentBet;
				const actualRaiseIncrease = targetRaiseTotal - currentBetLevel;

				actingPlayer.stack -= amountAdded;
				actingPlayer.currentBet = targetRaiseTotal;
				actingPlayer.totalBet += amountAdded;
				draft.pot += amountAdded;
				draft.currentBet = targetRaiseTotal;

				if (
					actualRaiseIncrease >= draft.minRaiseAmount ||
					actingPlayer.stack === 0
				) {
					draft.minRaiseAmount = actualRaiseIncrease;
				}

				actionDesc = `Seat ${playerSeat} raises to ${targetRaiseTotal}.`;
				if (actingPlayer.stack === 0) {
					actingPlayer.isAllIn = true;
					actionDesc += " (ALL-IN)";
				}

				for (const p of Object.values(draft.playerStates)) {
					if (
						p.userId !== actingPlayer.userId &&
						!p.isAllIn &&
						!p.isFolded &&
						!p.isSittingOut
					) {
						p.hasActed = false;
					}
				}
				break;
			}
			default: {
				console.error("applyAction called with unknown action:", action);
				actionDesc = `Seat ${playerSeat} performed unknown action.`;
				break;
			}
		}

		draft.handHistory.push(actionDesc);
		draft.lastUpdateTime = Date.now();
	});
}

function dealCommunityCards(gameState: GameState): GameState {
	return produce(gameState, (draft) => {
		const cardsToDeal =
			draft.phase === "preflop"
				? 3
				: draft.phase === "flop" || draft.phase === "turn"
					? 1
					: 0;

		if (cardsToDeal > 0) {
			const activePlayers = Object.values(draft.playerStates).filter(
				(p) => !p.isFolded && !p.isSittingOut,
			).length;

			if (activePlayers > 1) {
				if (draft.deck.length > 0) {
					draft.deck.shift();
				} else {
					console.error("Not enough cards in deck to burn!");
				}

				const dealtCards: Card[] = [];
				for (let i = 0; i < cardsToDeal; i++) {
					if (draft.deck.length > 0) {
						const card = draft.deck.shift();
						if (card) {
							draft.communityCards.push(card);
							dealtCards.push(card);
						} else {
							console.error("Deck shift returned undefined unexpectedly!");
							break;
						}
					} else {
						console.error("Deck unexpectedly ran out during community deal!");
						break;
					}
				}

				let phaseName = "";
				if (draft.phase === "preflop") {
					draft.phase = "flop";
					phaseName = "Flop";
				} else if (draft.phase === "flop") {
					draft.phase = "turn";
					phaseName = "Turn";
				} else if (draft.phase === "turn") {
					draft.phase = "river";
					phaseName = "River";
				}

				if (dealtCards.length > 0) {
					draft.handHistory.push(
						`${phaseName} dealt: ${dealtCards.map((c) => c.rank + c.suit).join(" ")}`,
					);
				}

				draft.currentBet = 0;
				draft.minRaiseAmount = draft.roomConfig.bigBlind;
				draft.lastActionPlayerSeat = null;

				for (const p of Object.values(draft.playerStates)) {
					p.currentBet = 0;
					if (!p.isAllIn && !p.isFolded && !p.isSittingOut) {
						p.hasActed = false;
					}
				}

				draft.currentPlayerSeat = getFirstToActSeat(draft);

				while (draft.currentPlayerSeat) {
					const currentUserIdInLoop = Object.keys(draft.playerStates).find(
						(uid) =>
							draft.playerStates[uid].seatNumber === draft.currentPlayerSeat,
					);
					if (
						currentUserIdInLoop &&
						draft.playerStates[currentUserIdInLoop]?.isAllIn
					) {
						const seatBeforeSkip = draft.currentPlayerSeat;
						draft.currentPlayerSeat = getNextActivePlayerSeat(
							draft,
							seatBeforeSkip,
						);
						if (
							draft.currentPlayerSeat === seatBeforeSkip ||
							draft.currentPlayerSeat === null
						) {
							draft.currentPlayerSeat = null;
							break;
						}
					} else {
						break;
					}
				}

				if (draft.currentPlayerSeat) {
					draft.handHistory.push(
						`Seat ${draft.currentPlayerSeat} is first to act.`,
					);
				} else {
					draft.handHistory.push(
						"All remaining players are all-in or only one player left. No further betting on this street.",
					);
				}
			} else {
				draft.handHistory.push("Only one player remaining. Hand concludes.");
				draft.phase = "showdown";
			}
		}

		draft.lastUpdateTime = Date.now();
	});
}

function dealRemainingBoard(gameState: GameState): GameState {
	return produce(gameState, (draft) => {
		const cardsNeeded = 5 - draft.communityCards.length;

		if (cardsNeeded <= 0) {
			return;
		}

		draft.handHistory.push("Dealing remaining community cards...");

		if (draft.phase === "preflop" && draft.communityCards.length < 3) {
			if (draft.deck.length > 0) draft.deck.shift();
			else console.error("Not enough cards to burn before flop!");
			const flopCards: Card[] = [];
			for (let i = 0; i < 3; i++) {
				if (draft.deck.length > 0) {
					const card = draft.deck.shift();
					if (card) {
						draft.communityCards.push(card);
						flopCards.push(card);
					} else break;
				} else break;
			}
			if (flopCards.length > 0) {
				draft.handHistory.push(
					`Flop: ${flopCards.map((c) => c.rank + c.suit).join(" ")}`,
				);
			}
			draft.phase = "flop";
		}

		if (draft.phase === "flop" && draft.communityCards.length < 4) {
			if (draft.deck.length > 0) draft.deck.shift();
			else console.error("Not enough cards to burn before turn!");
			if (draft.deck.length > 0) {
				const card = draft.deck.shift();
				if (card) {
					draft.communityCards.push(card);
					draft.handHistory.push(`Turn: ${card.rank}${card.suit}`);
				}
			} else console.error("Deck ran out dealing turn!");
			draft.phase = "turn";
		}

		if (draft.phase === "turn" && draft.communityCards.length < 5) {
			if (draft.deck.length > 0) draft.deck.shift();
			else console.error("Not enough cards to burn before river!");
			if (draft.deck.length > 0) {
				const card = draft.deck.shift();
				if (card) {
					draft.communityCards.push(card);
					draft.handHistory.push(`River: ${card.rank}${card.suit}`);
				}
			} else console.error("Deck ran out dealing river!");
			draft.phase = "river";
		}

		if (draft.communityCards.length >= 5) {
			draft.phase = "river";
		}

		draft.currentPlayerSeat = null;
		draft.lastUpdateTime = Date.now();
	});
}

export function isBettingRoundOver(gameState: GameState): boolean {
	const activePlayers = Object.values(gameState.playerStates).filter(
		(p) => !p.isFolded && !p.isSittingOut,
	);

	if (activePlayers.length <= 1) {
		return true;
	}

	const playersWhoCanAct = activePlayers.filter((p) => !p.isAllIn);

	if (playersWhoCanAct.length === 0) {
		return true;
	}

	const allWhoCanActHaveActed = playersWhoCanAct.every((p) => {
		if (
			gameState.phase === "preflop" &&
			p.seatNumber === gameState.bigBlindSeat &&
			p.currentBet === gameState.currentBet &&
			gameState.lastActionPlayerSeat !== p.seatNumber
		) {
			const preBBPlayers = activePlayers.filter(
				(ap) => ap.seatNumber !== p.seatNumber,
			);
			const someoneElseActed = preBBPlayers.some((ap) => ap.hasActed);
			if (!someoneElseActed && playersWhoCanAct.length > 1) {
				return false;
			}
		}
		return p.hasActed;
	});

	if (!allWhoCanActHaveActed) {
		return false;
	}

	const highestBetInRound = gameState.currentBet;
	const allBetsMatchedOrAllIn = activePlayers.every(
		(p) => p.currentBet === highestBetInRound || p.isAllIn,
	);

	return allBetsMatchedOrAllIn;
}

interface PotInfo {
	amount: number;
	eligiblePlayers: string[];
}

function calculatePots(playerStates: Record<string, PlayerState>): PotInfo[] {
	const pots: PotInfo[] = [];
	const playersInPot = Object.values(playerStates).filter(
		(p) => p.totalBet > 0 || (!p.isFolded && !p.isSittingOut),
	);

	if (playersInPot.length === 0) return [];

	const betLevels = [
		0,
		...new Set(playersInPot.map((p) => p.totalBet).filter((bet) => bet > 0)),
	].sort((a, b) => a - b);

	let lastBetLevel = 0;

	for (const level of betLevels) {
		if (level <= lastBetLevel) continue;

		const potIncrement = level - lastBetLevel;
		let currentPotContribution = 0;
		const eligibleForThisPot: string[] = [];

		for (const player of playersInPot) {
			const contributionAtThisLayer = Math.min(
				potIncrement,
				Math.max(0, player.totalBet - lastBetLevel),
			);

			if (contributionAtThisLayer > 0) {
				currentPotContribution += contributionAtThisLayer;
				if (!player.isFolded && !player.isSittingOut) {
					eligibleForThisPot.push(player.userId);
				}
			} else if (
				player.totalBet > level &&
				!player.isFolded &&
				!player.isSittingOut
			) {
				eligibleForThisPot.push(player.userId);
			}
		}

		if (currentPotContribution > 0 && eligibleForThisPot.length > 0) {
			pots.push({
				amount: currentPotContribution,
				eligiblePlayers: [...new Set(eligibleForThisPot)],
			});
		}

		lastBetLevel = level;
	}

	return pots;
}

function determineWinner(gameState: GameState): GameState {
	return produce(gameState, (draft) => {
		draft.phase = "showdown";
		draft.handHistory.push("--- Showdown ---");

		const playersToShowdown = Object.values(draft.playerStates).filter(
			(p) => !p.isFolded && !p.isSittingOut && p.totalBet > 0,
		);

		if (playersToShowdown.length === 1) {
			const winnerId = playersToShowdown[0].userId;
			const winner = draft.playerStates[winnerId];
			const totalPot = Object.values(draft.playerStates).reduce(
				(sum, p) => sum + p.totalBet,
				0,
			);
			winner.stack += totalPot;
			draft.handHistory.push(
				`Seat ${winner.seatNumber} wins ${totalPot} (uncontested).`,
			);
			draft.pot = 0;
		} else if (playersToShowdown.length > 1) {
			const results: Record<string, HandEvaluationResult> = {};
			draft.handHistory.push("Evaluating hands...");

			for (const p of playersToShowdown) {
				if (p.hand.length === 2) {
					results[p.userId] = evaluateHand(p.hand, draft.communityCards);
					draft.handHistory.push(
						`Seat ${p.seatNumber} shows ${p.hand.map((c) => c.rank + c.suit).join(" ")} - ${results[p.userId].rankName} (${results[p.userId].bestHand.map((c) => c.rank + c.suit).join(" ")})`,
					);
				} else {
					draft.handHistory.push(
						`Seat ${p.seatNumber} mucks (Error: No hole cards found?).`,
					);
					results[p.userId] = {
						rankValue: HandRank.HIGH_CARD,
						rankName: "Mucked/Error",
						bestHand: [],
						kickers: [-1],
					};
				}
			}

			const pots = calculatePots(draft.playerStates);
			let totalAwarded = 0;

			draft.handHistory.push("--- Pot Distribution ---");

			for (let index = 0; index < pots.length; index++) {
				const pot = pots[index];
				const potName = pots.length > 1 ? `Side Pot ${index + 1}` : "Main Pot";
				draft.handHistory.push(
					`${potName} (${pot.amount}) - Eligible: ${pot.eligiblePlayers
						.map((uid) => `Seat ${draft.playerStates[uid].seatNumber}`)
						.join(", ")}`,
				);

				let bestRankValueInPot = -1;
				let winnersInPot: string[] = [];
				let winningKickersInPot: number[] = [];
				let winningHandDesc = "";

				for (const userId of pot.eligiblePlayers) {
					if (!results[userId]) continue;

					const result = results[userId];

					if (result.rankValue > bestRankValueInPot) {
						bestRankValueInPot = result.rankValue;
						winnersInPot = [userId];
						winningKickersInPot = result.kickers;
						winningHandDesc = result.rankName;
					} else if (result.rankValue === bestRankValueInPot) {
						const kickerComparison = compareKickers(
							result.kickers,
							winningKickersInPot,
						);
						if (kickerComparison > 0) {
							winnersInPot = [userId];
							winningKickersInPot = result.kickers;
						} else if (kickerComparison === 0) {
							winnersInPot.push(userId);
						}
					}
				}

				if (winnersInPot.length > 0) {
					const amountPerWinner = Math.floor(pot.amount / winnersInPot.length);
					let remainder = pot.amount % winnersInPot.length;

					const sortedWinners = winnersInPot.sort((a, b) => {
						const seatA = draft.playerStates[a].seatNumber;
						const seatB = draft.playerStates[b].seatNumber;
						const maxSeats = Math.max(
							...Object.values(draft.playerStates).map((p) => p.seatNumber),
							10,
						);
						const aRel = (seatA - draft.smallBlindSeat + maxSeats) % maxSeats;
						const bRel = (seatB - draft.smallBlindSeat + maxSeats) % maxSeats;
						return aRel - bRel;
					});

					for (const winnerId of sortedWinners) {
						const winnerState = draft.playerStates[winnerId];
						let award = amountPerWinner;
						if (remainder > 0) {
							award += 1;
							remainder -= 1;
						}
						winnerState.stack += award;
						totalAwarded += award;
						draft.handHistory.push(
							`Seat ${winnerState.seatNumber} wins ${award} from ${potName} with ${winningHandDesc}`,
						);
					}
				} else {
					draft.handHistory.push(
						`Error: No eligible winners found for ${potName}. Pot amount ${pot.amount} unawarded.`,
					);
				}
			}
			draft.pot = 0;

			const totalPotFromBets = Object.values(draft.playerStates).reduce(
				(sum, p) => sum + p.totalBet,
				0,
			);
			if (totalAwarded !== totalPotFromBets) {
				console.warn(
					`Pot distribution discrepancy: Total Pot (${totalPotFromBets}), Total Awarded (${totalAwarded}). Remainder: ${totalPotFromBets - totalAwarded}`,
				);
			}
		} else {
			draft.handHistory.push("Error: No players eligible for showdown.");
			draft.pot = 0;
		}

		for (const p of Object.values(draft.playerStates)) {
			p.currentBet = 0;
			p.totalBet = 0;
			p.hand = [];
			p.hasActed = false;
			p.isFolded = false;
		}

		draft.phase = "end_hand";
		draft.currentPlayerSeat = null;
		draft.lastUpdateTime = Date.now();
		draft.handHistory.push("--- Hand End ---");
	});
}

export async function performAction(
	currentGameState: GameState,
	userId: string,
	action: ClientPokerAction,
): Promise<GameState> {
	const validation = validateAction(
		currentGameState,
		userId,
		action.action,
		action.action === "bet" || action.action === "raise"
			? action.amount
			: undefined,
	);

	if (!validation.isValid || !validation.playerState) {
		throw new Error(`Invalid action: ${validation.message}`);
	}

	let nextState = applyAction(
		currentGameState,
		validation.playerState,
		action.action,
		action.action === "bet" || action.action === "raise"
			? action.amount
			: undefined,
	);

	while (true) {
		const activePlayers = Object.values(nextState.playerStates).filter(
			(p) => !p.isFolded && !p.isSittingOut,
		);

		if (activePlayers.length <= 1) {
			nextState = produce(nextState, (draft) => {
				draft.handHistory.push(
					activePlayers.length === 1
						? "Only one player remains."
						: "No players remain.",
				);
			});
			nextState = determineWinner(nextState);
			break;
		}

		const roundOver = isBettingRoundOver(nextState);

		if (roundOver) {
			nextState = produce(nextState, (draft) => {
				draft.handHistory.push("Betting round concluded.");
				draft.currentPlayerSeat = null;
			});

			const playersWhoCanAct = activePlayers.filter((p) => !p.isAllIn);

			if (playersWhoCanAct.length === 0) {
				if (
					nextState.phase !== "river" &&
					nextState.phase !== "showdown" &&
					nextState.phase !== "end_hand"
				) {
					nextState = produce(nextState, (draft) => {
						draft.handHistory.push(
							"All remaining players are all-in. Dealing remaining board...",
						);
					});
					nextState = dealRemainingBoard(nextState);
				}
				nextState = determineWinner(nextState);
				break;
			}

			if (nextState.phase === "river") {
				nextState = determineWinner(nextState);
				break;
			}

			if (nextState.phase !== "showdown" && nextState.phase !== "end_hand") {
				nextState = dealCommunityCards(nextState);
				if (nextState.currentPlayerSeat !== null) {
					break;
				}
			} else {
				break;
			}
		} else {
			const lastActorSeat = nextState.lastActionPlayerSeat;
			const seatToStartSearchFrom =
				lastActorSeat ??
				(nextState.phase === "preflop"
					? nextState.bigBlindSeat
					: nextState.dealerSeat);

			const nextPlayerSeat = getNextActivePlayerSeat(
				nextState,
				seatToStartSearchFrom,
			);

			nextState = produce(nextState, (draft) => {
				draft.currentPlayerSeat = nextPlayerSeat;
				if (draft.currentPlayerSeat) {
					draft.handHistory.push(
						`Seat ${draft.currentPlayerSeat} is next to act.`,
					);
				} else {
					console.error(
						"CRITICAL ERROR: Betting round appears ongoing, but cannot determine next player.",
						{
							phase: draft.phase,
							lastActionPlayerSeat: lastActorSeat,
							playerStates: draft.playerStates,
						},
					);
					draft.handHistory.push("Error determining next player. Ending hand.");

					draft.phase = "showdown";
				}
			});

			if (
				nextState.currentPlayerSeat === null &&
				nextState.phase === "showdown"
			) {
				nextState = determineWinner(nextState);
			}

			break;
		}
	}

	return produce(nextState, (draft) => {
		draft.lastUpdateTime = Date.now();
	});
}
