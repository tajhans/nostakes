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
				const bbUserId = Object.keys(initialGameState.playerStates).find(
					(uid) =>
						initialGameState.playerStates[uid].seatNumber === bigBlindSeat,
				);
				const bbIsAllIn = bbUserId
					? initialGameState.playerStates[bbUserId]?.isAllIn
					: false;

				if (
					nextSeat === initialGameState.lastActionPlayerSeat &&
					bbIsAllIn &&
					initialGameState.lastActionPlayerSeat === bigBlindSeat
				) {
					initialGameState.currentPlayerSeat = null;
				} else {
					initialGameState.currentPlayerSeat = null;
				}
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
		return {
			rankValue: HandRank.HIGH_CARD,
			rankName: "Invalid Hand (< 5 cards)",
			bestHand: [],
			kickers: [],
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
		const currentResult = evaluateFiveCardHand(hand, bestResult);
		if (
			currentResult.rankValue > bestResult.rankValue ||
			(currentResult.rankValue === bestResult.rankValue &&
				compareKickers(currentResult.kickers, bestResult.kickers) > 0)
		) {
			bestResult = currentResult;
		}
	}

	return bestResult;
}

function evaluateFiveCardHand(
	hand: Card[],
	bestResult: HandEvaluationResult,
): HandEvaluationResult {
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
	if (uniqueRanksSorted.length >= 5) {
		for (let i = 0; i <= uniqueRanksSorted.length - 5; i++) {
			if (uniqueRanksSorted[i] - uniqueRanksSorted[i + 4] === 4) {
				isStraight = true;
				straightHighCard = uniqueRanksSorted[i];
				break;
			}
		}
	}
	const isAceLowStraight =
		uniqueRanksSorted.length >= 5 &&
		uniqueRanksSorted[0] === 14 &&
		uniqueRanksSorted.includes(5) &&
		uniqueRanksSorted.includes(4) &&
		uniqueRanksSorted.includes(3) &&
		uniqueRanksSorted.includes(2);

	if (isFlush && (isStraight || isAceLowStraight)) {
		const highCard = isAceLowStraight ? 5 : straightHighCard;
		const rank =
			highCard === 14 ? HandRank.ROYAL_FLUSH : HandRank.STRAIGHT_FLUSH;
		const bestStraightFlushHand = isAceLowStraight
			? sortedHand
					.filter((c) => [14, 5, 4, 3, 2].includes(RANK_VALUES[c.rank]))
					.sort((a, b) => {
						const valA = RANK_VALUES[a.rank] === 14 ? 1 : RANK_VALUES[a.rank];
						const valB = RANK_VALUES[b.rank] === 14 ? 1 : RANK_VALUES[b.rank];
						return valB - valA;
					})
			: sortedHand.filter((c) => {
					const rankVal = RANK_VALUES[c.rank];
					return rankVal <= straightHighCard && rankVal > straightHighCard - 5;
				});

		return {
			rankValue: rank,
			rankName: HAND_RANK_NAMES[rank],
			bestHand: bestStraightFlushHand.slice(0, 5),
			kickers: [highCard],
		};
	}

	if (counts[0] === 4) {
		const fourRank = uniqueRanksSorted.find((r) => rankCounts[r] === 4);
		if (fourRank === undefined) {
			console.error("Logic error: Expected fourRank to be defined.");
			return bestResult;
		}
		const kicker = uniqueRanksSorted.find((r) => r !== fourRank);
		if (kicker === undefined) {
			console.error("Logic error: Expected kicker to be defined.");
			return bestResult;
		}
		const kickerCard = sortedHand.find((c) => RANK_VALUES[c.rank] === kicker);
		if (!kickerCard) {
			console.error("Logic error: Expected kickerCard to be defined.");
			return bestResult;
		}
		const bestFourOfAKindHand = sortedHand
			.filter((c) => RANK_VALUES[c.rank] === fourRank)
			.concat(kickerCard);
		return {
			rankValue: HandRank.FOUR_OF_A_KIND,
			rankName: HAND_RANK_NAMES[HandRank.FOUR_OF_A_KIND],
			bestHand: bestFourOfAKindHand.slice(0, 5),
			kickers: [fourRank, kicker],
		};
	}

	if (counts[0] === 3 && counts[1] >= 2) {
		const threeRank = uniqueRanksSorted.find((r) => rankCounts[r] === 3);
		if (threeRank === undefined) {
			console.error("Logic error: Expected threeRank to be defined.");
			return bestResult;
		}
		const pairRank = uniqueRanksSorted.find(
			(r) => r !== threeRank && rankCounts[r] >= 2,
		);
		if (pairRank === undefined) {
			console.error("Logic error: Expected pairRank to be defined.");
			return bestResult;
		}
		const pairCards = sortedHand
			.filter((c) => RANK_VALUES[c.rank] === pairRank)
			.slice(0, 2);
		if (pairCards.length < 2) {
			console.error("Logic error: Expected pairCards to have length 2.");
			return bestResult;
		}
		const bestFullHouseHand = sortedHand
			.filter((c) => RANK_VALUES[c.rank] === threeRank)
			.concat(pairCards);
		return {
			rankValue: HandRank.FULL_HOUSE,
			rankName: HAND_RANK_NAMES[HandRank.FULL_HOUSE],
			bestHand: bestFullHouseHand.slice(0, 5),
			kickers: [threeRank, pairRank],
		};
	}

	if (isFlush) {
		return {
			rankValue: HandRank.FLUSH,
			rankName: HAND_RANK_NAMES[HandRank.FLUSH],
			bestHand: sortedHand.slice(0, 5),
			kickers: ranks.slice(0, 5),
		};
	}

	if (isStraight || isAceLowStraight) {
		const highCard = isAceLowStraight ? 5 : straightHighCard;
		let bestStraightHand: Card[] = [];
		if (isAceLowStraight) {
			const card5 = sortedHand.find((c) => RANK_VALUES[c.rank] === 5);
			const card4 = sortedHand.find((c) => RANK_VALUES[c.rank] === 4);
			const card3 = sortedHand.find((c) => RANK_VALUES[c.rank] === 3);
			const card2 = sortedHand.find((c) => RANK_VALUES[c.rank] === 2);
			const cardA = sortedHand.find((c) => RANK_VALUES[c.rank] === 14);
			if (card5 && card4 && card3 && card2 && cardA) {
				bestStraightHand = [card5, card4, card3, card2, cardA];
			} else {
				console.error("Could not find all cards for Ace-low straight");
				return bestResult;
			}
		} else {
			bestStraightHand = sortedHand.filter((c) => {
				const rankVal = RANK_VALUES[c.rank];
				return rankVal <= straightHighCard && rankVal > straightHighCard - 5;
			});
		}

		const uniqueRankStraightHand = Array.from(
			new Map(
				bestStraightHand.map((card) => [RANK_VALUES[card.rank], card]),
			).values(),
		).sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank]);

		return {
			rankValue: HandRank.STRAIGHT,
			rankName: HAND_RANK_NAMES[HandRank.STRAIGHT],
			bestHand: uniqueRankStraightHand.slice(0, 5),
			kickers: [highCard],
		};
	}

	if (counts[0] === 3) {
		const threeRank = uniqueRanksSorted.find((r) => rankCounts[r] === 3);
		if (threeRank === undefined) {
			console.error("Logic error: Expected threeRank to be defined.");
			return bestResult;
		}
		const kickers = uniqueRanksSorted
			.filter((r) => r !== threeRank)
			.slice(0, 2);
		const bestThreeOfAKindHand = sortedHand
			.filter((c) => RANK_VALUES[c.rank] === threeRank)
			.concat(
				sortedHand
					.filter((c) => kickers.includes(RANK_VALUES[c.rank]))
					.slice(0, 2),
			);
		return {
			rankValue: HandRank.THREE_OF_A_KIND,
			rankName: HAND_RANK_NAMES[HandRank.THREE_OF_A_KIND],
			bestHand: bestThreeOfAKindHand.slice(0, 5),
			kickers: [threeRank, ...kickers],
		};
	}

	if (counts[0] === 2 && counts[1] === 2) {
		const pairs = uniqueRanksSorted
			.filter((r) => rankCounts[r] === 2)
			.slice(0, 2);
		const kicker = uniqueRanksSorted.find((r) => !pairs.includes(r));
		if (kicker === undefined) {
			console.error("Logic error: Expected kicker to be defined.");
			return bestResult;
		}
		const kickerCard = sortedHand.find((c) => RANK_VALUES[c.rank] === kicker);
		if (!kickerCard) {
			console.error("Logic error: Expected kickerCard to be defined.");
			return bestResult;
		}
		const bestTwoPairHand = sortedHand
			.filter((c) => pairs.includes(RANK_VALUES[c.rank]))
			.concat(kickerCard);
		return {
			rankValue: HandRank.TWO_PAIR,
			rankName: HAND_RANK_NAMES[HandRank.TWO_PAIR],
			bestHand: bestTwoPairHand.slice(0, 5),
			kickers: [...pairs, kicker],
		};
	}

	if (counts[0] === 2) {
		const pairRank = uniqueRanksSorted.find((r) => rankCounts[r] === 2);
		if (pairRank === undefined) {
			console.error("Logic error: Expected pairRank to be defined.");
			return bestResult;
		}
		const kickers = uniqueRanksSorted.filter((r) => r !== pairRank).slice(0, 3);
		const bestPairHand = sortedHand
			.filter((c) => RANK_VALUES[c.rank] === pairRank)
			.concat(
				sortedHand
					.filter((c) => kickers.includes(RANK_VALUES[c.rank]))
					.slice(0, 3),
			);
		return {
			rankValue: HandRank.PAIR,
			rankName: HAND_RANK_NAMES[HandRank.PAIR],
			bestHand: bestPairHand.slice(0, 5),
			kickers: [pairRank, ...kickers],
		};
	}

	return {
		rankValue: HandRank.HIGH_CARD,
		rankName: HAND_RANK_NAMES[HandRank.HIGH_CARD],
		bestHand: sortedHand.slice(0, 5),
		kickers: ranks.slice(0, 5),
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

	const currentSeatIndex = playerSeats.indexOf(startSeat);

	if (currentSeatIndex === -1) {
		let nextSeat = null;
		for (const seat of playerSeats) {
			if (seat > startSeat) {
				nextSeat = seat;
				break;
			}
		}

		return nextSeat ?? playerSeats[0];
	}

	const nextIndex = (currentSeatIndex + 1) % playerSeats.length;
	return playerSeats[nextIndex];
}

export function getFirstToActSeat(currentState: GameState): number | null {
	const dealerSeat = currentState.dealerSeat;

	let searchSeat = dealerSeat;
	let firstSeat: number | null = null;
	const checkedSeats = new Set<number>();
	const maxSeats = Math.max(
		...Object.values(currentState.playerStates).map((p) => p.seatNumber),
		10,
	);

	do {
		let nextSearchSeatNum = (searchSeat % maxSeats) + 1;
		let foundNext = false;
		while (!foundNext) {
			const potentialNextPlayer = Object.values(currentState.playerStates).find(
				(p) => p.seatNumber === nextSearchSeatNum,
			);
			if (potentialNextPlayer) {
				searchSeat = nextSearchSeatNum;
				foundNext = true;
			} else {
				nextSearchSeatNum = (nextSearchSeatNum % maxSeats) + 1;
				if (nextSearchSeatNum === dealerSeat + 1) break;
			}
		}
		if (!foundNext) break;

		if (checkedSeats.has(searchSeat)) {
			break;
		}
		checkedSeats.add(searchSeat);

		const player = Object.values(currentState.playerStates).find(
			(p) => p.seatNumber === searchSeat,
		);

		if (player && !player.isFolded && !player.isAllIn && !player.isSittingOut) {
			firstSeat = searchSeat;
			break;
		}
	} while (searchSeat !== dealerSeat);

	if (!firstSeat) {
		return (
			Object.values(currentState.playerStates).find(
				(p) => !p.isFolded && !p.isAllIn && !p.isSittingOut,
			)?.seatNumber ?? null
		);
	}

	return firstSeat;
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
			if (
				playerCurrentBet < currentBet &&
				!(
					gameState.phase === "preflop" &&
					playerState.seatNumber === gameState.bigBlindSeat &&
					playerCurrentBet === currentBet
				)
			) {
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
					return { isValid: false, message: "Use check instead of calling." };
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
					message: "Raise must add chips to your current bet.",
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
	const newState = structuredClone(gameState);
	const actingPlayer = newState.playerStates[playerState.userId];
	actingPlayer.hasActed = true;
	newState.lastActionPlayerSeat = actingPlayer.seatNumber;

	let actionDesc = "";
	const playerSeat = actingPlayer.seatNumber;
	const currentBetLevel = newState.currentBet;

	switch (action) {
		case "fold":
			actingPlayer.isFolded = true;
			actionDesc = `Seat ${playerSeat} folds.`;
			break;
		case "check":
			if (
				newState.phase === "preflop" &&
				actingPlayer.seatNumber === newState.bigBlindSeat &&
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
			newState.pot += amountToCall;
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
			newState.pot += betAmountValue;
			newState.currentBet = betAmountValue;
			newState.minRaiseAmount = betAmountValue;
			actionDesc = `Seat ${playerSeat} bets ${betAmountValue}.`;
			if (actingPlayer.stack === 0) {
				actingPlayer.isAllIn = true;
				actionDesc += " (ALL-IN)";
			}
			for (const p of Object.values(newState.playerStates)) {
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
			const validRaiseAmount = amount !== undefined && amount > 0 ? amount : 0;
			const targetRaiseTotal = Math.min(
				validRaiseAmount,
				actingPlayer.stack + actingPlayer.currentBet,
			);
			const amountAdded = targetRaiseTotal - actingPlayer.currentBet;
			const actualRaiseIncrease = targetRaiseTotal - currentBetLevel;

			actingPlayer.stack -= amountAdded;
			actingPlayer.currentBet = targetRaiseTotal;
			actingPlayer.totalBet += amountAdded;
			newState.pot += amountAdded;
			newState.currentBet = targetRaiseTotal;

			if (
				actualRaiseIncrease >= gameState.minRaiseAmount ||
				actingPlayer.stack === 0
			) {
				newState.minRaiseAmount = actualRaiseIncrease;
			}

			actionDesc = `Seat ${playerSeat} raises to ${targetRaiseTotal}.`;
			if (actingPlayer.stack === 0) {
				actingPlayer.isAllIn = true;
				actionDesc += " (ALL-IN)";
			}

			for (const p of Object.values(newState.playerStates)) {
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
			const _exhaustiveCheck: never = action;

			actionDesc = `Seat ${playerSeat} performed unknown action.`;
			break;
		}
	}

	newState.handHistory.push(actionDesc);
	newState.lastUpdateTime = Date.now();

	return newState;
}

function dealCommunityCards(gameState: GameState): GameState {
	const newState = structuredClone(gameState);

	const cardsToDeal =
		newState.phase === "preflop"
			? 3
			: newState.phase === "flop" || newState.phase === "turn"
				? 1
				: 0;

	if (cardsToDeal > 0) {
		const activePlayers = Object.values(newState.playerStates).filter(
			(p) => !p.isFolded && !p.isSittingOut,
		).length;

		if (activePlayers > 1) {
			if (newState.deck.length > 0) {
				newState.deck.shift();
			} else {
				console.error("Not enough cards in deck to burn!");
			}

			const dealtCards: Card[] = [];
			for (let i = 0; i < cardsToDeal; i++) {
				if (newState.deck.length > 0) {
					const card = newState.deck.shift();
					if (card) {
						newState.communityCards.push(card);
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
			if (newState.phase === "preflop") {
				newState.phase = "flop";
				phaseName = "Flop";
			} else if (newState.phase === "flop") {
				newState.phase = "turn";
				phaseName = "Turn";
			} else if (newState.phase === "turn") {
				newState.phase = "river";
				phaseName = "River";
			}

			if (dealtCards.length > 0) {
				newState.handHistory.push(
					`${phaseName} dealt: ${dealtCards.map((c) => c.rank + c.suit).join(" ")}`,
				);
			}

			newState.currentBet = 0;
			newState.minRaiseAmount = newState.roomConfig.bigBlind;
			newState.lastActionPlayerSeat = null;

			for (const p of Object.values(newState.playerStates)) {
				p.currentBet = 0;
				if (!p.isAllIn && !p.isFolded && !p.isSittingOut) {
					p.hasActed = false;
				}
			}

			newState.currentPlayerSeat = getFirstToActSeat(newState);

			while (newState.currentPlayerSeat) {
				const currentUserIdInLoop = Object.keys(newState.playerStates).find(
					(uid) =>
						newState.playerStates[uid].seatNumber ===
						newState.currentPlayerSeat,
				);
				if (
					currentUserIdInLoop &&
					newState.playerStates[currentUserIdInLoop]?.isAllIn
				) {
					const currentSeat = newState.currentPlayerSeat;
					const nextSeat = getNextActivePlayerSeat(newState, currentSeat);
					if (nextSeat === null || nextSeat === currentSeat) {
						newState.currentPlayerSeat = null;
						break;
					}
					newState.currentPlayerSeat = nextSeat;
				} else {
					break;
				}
			}

			if (newState.currentPlayerSeat) {
				newState.handHistory.push(
					`Seat ${newState.currentPlayerSeat} is first to act.`,
				);
			} else {
				newState.handHistory.push(
					"All remaining players are all-in or only one player left. No further betting.",
				);
			}
		} else {
			newState.handHistory.push("Only one player remaining. Hand concludes.");
			newState.phase = "showdown";
		}
	}

	newState.lastUpdateTime = Date.now();
	return newState;
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

	const allWhoCanActHaveActed = playersWhoCanAct.every((p) => p.hasActed);
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
		(p) => p.totalBet > 0,
	);

	if (playersInPot.length === 0) return [];

	const sortedPlayersByBet = [...playersInPot].sort(
		(a, b) => a.totalBet - b.totalBet,
	);

	let lastBetLevel = 0;
	const contributingPlayerIds = new Set(
		sortedPlayersByBet.map((p) => p.userId),
	);

	while (contributingPlayerIds.size > 0) {
		let currentLevelCap = Number.POSITIVE_INFINITY;
		for (const playerId of contributingPlayerIds) {
			currentLevelCap = Math.min(
				currentLevelCap,
				playerStates[playerId].totalBet,
			);
		}

		const potIncrement = currentLevelCap - lastBetLevel;

		if (potIncrement <= 0) {
			const playersAtThisLevel = sortedPlayersByBet.filter(
				(p) => p.totalBet === currentLevelCap,
			);
			for (const player of playersAtThisLevel) {
				contributingPlayerIds.delete(player.userId);
			}
			lastBetLevel = currentLevelCap;
			continue;
		}

		let currentPotContribution = 0;
		const eligibleForThisPot: string[] = [];

		for (const player of playersInPot) {
			const contributionAtThisLayer = Math.min(
				potIncrement,
				Math.max(0, player.totalBet - lastBetLevel),
			);

			if (contributionAtThisLayer > 0) {
				currentPotContribution += contributionAtThisLayer;
				if (!player.isFolded) {
					eligibleForThisPot.push(player.userId);
				}
			}
		}

		if (currentPotContribution > 0 && eligibleForThisPot.length > 0) {
			pots.push({
				amount: currentPotContribution,
				eligiblePlayers: [...new Set(eligibleForThisPot)],
			});
		}

		lastBetLevel = currentLevelCap;
		const playersAtThisLevel = sortedPlayersByBet.filter(
			(p) => p.totalBet === currentLevelCap,
		);
		for (const player of playersAtThisLevel) {
			contributingPlayerIds.delete(player.userId);
		}
	}

	return pots;
}

function determineWinner(gameState: GameState): GameState {
	const newState = structuredClone(gameState);
	newState.phase = "showdown";
	newState.handHistory.push("--- Showdown ---");

	const playersToShowdown = Object.values(newState.playerStates).filter(
		(p) => !p.isFolded && !p.isSittingOut && p.totalBet > 0,
	);

	if (playersToShowdown.length === 1) {
		const winner = playersToShowdown[0];
		const totalPot = Object.values(newState.playerStates).reduce(
			(sum, p) => sum + p.totalBet,
			0,
		);
		winner.stack += totalPot;
		newState.handHistory.push(
			`Seat ${winner.seatNumber} wins ${totalPot} (uncontested).`,
		);
		newState.pot = 0;
	} else if (playersToShowdown.length > 1) {
		const results: Record<string, HandEvaluationResult> = {};
		for (const p of playersToShowdown) {
			if (p.hand.length === 2) {
				const initialBest: HandEvaluationResult = {
					rankValue: HandRank.HIGH_CARD,
					rankName: "High Card",
					bestHand: [],
					kickers: [],
				};
				results[p.userId] = evaluateHand(p.hand, newState.communityCards);
				newState.handHistory.push(
					`Seat ${p.seatNumber} shows ${p.hand.map((c) => c.rank + c.suit).join(" ")} (${results[p.userId].rankName}, Best: ${results[p.userId].bestHand.map((c) => c.rank + c.suit).join(" ")})`,
				);
			} else {
				newState.handHistory.push(
					`Seat ${p.seatNumber} did not have cards for showdown.`,
				);
			}
		}

		const pots = calculatePots(newState.playerStates);
		let totalAwarded = 0;

		for (let index = 0; index < pots.length; index++) {
			const pot = pots[index];
			const potName = pots.length > 1 ? `Side pot ${index + 1}` : "Main pot";
			newState.handHistory.push(
				`${potName} (${pot.amount}) - Eligible: ${pot.eligiblePlayers
					.map((uid) => `Seat ${newState.playerStates[uid].seatNumber}`)
					.join(", ")}`,
			);

			let bestRankValue = -1;
			let winners: string[] = [];
			let winningKickers: number[] = [];
			let winningHandDesc = "";

			for (const userId of pot.eligiblePlayers) {
				if (!results[userId]) continue;
				const result = results[userId];

				if (result.rankValue > bestRankValue) {
					bestRankValue = result.rankValue;
					winners = [userId];
					winningKickers = result.kickers;
					winningHandDesc = result.rankName;
				} else if (result.rankValue === bestRankValue) {
					const kickerComparison = compareKickers(
						result.kickers,
						winningKickers,
					);
					if (kickerComparison > 0) {
						winners = [userId];
						winningKickers = result.kickers;
						winningHandDesc = result.rankName;
					} else if (kickerComparison === 0) {
						winners.push(userId);
					}
				}
			}

			if (winners.length > 0) {
				const amountPerWinner = Math.floor(pot.amount / winners.length);
				let remainder = pot.amount % winners.length;

				const sortedWinners = winners.sort((a, b) => {
					const seatA = newState.playerStates[a].seatNumber;
					const seatB = newState.playerStates[b].seatNumber;
					const maxSeats = Math.max(
						...Object.values(newState.playerStates).map((p) => p.seatNumber),
						10,
					);
					const aRel = (seatA - newState.smallBlindSeat + maxSeats) % maxSeats;
					const bRel = (seatB - newState.smallBlindSeat + maxSeats) % maxSeats;
					return aRel - bRel;
				});

				for (const winnerId of sortedWinners) {
					const winnerState = newState.playerStates[winnerId];
					let award = amountPerWinner;
					if (remainder > 0) {
						award += 1;
						remainder -= 1;
					}
					winnerState.stack += award;
					totalAwarded += award;
					newState.handHistory.push(
						`Seat ${winnerState.seatNumber} wins ${award} from ${potName} with ${winningHandDesc}`,
					);
				}
			} else {
				newState.handHistory.push(`No eligible winners for ${potName}.`);
			}
		}
		newState.pot = 0;

		const totalPotFromBets = Object.values(newState.playerStates).reduce(
			(sum, p) => sum + p.totalBet,
			0,
		);
		if (totalAwarded !== totalPotFromBets) {
			console.warn(
				`Discrepancy in pot distribution: Total Pot (${totalPotFromBets}), Total Awarded (${totalAwarded})`,
			);
		}
	} else {
		newState.handHistory.push("Error: No players eligible for showdown.");
		newState.pot = 0;
	}

	for (const p of Object.values(newState.playerStates)) {
		p.currentBet = 0;
		p.totalBet = 0;
		p.hand = [];
		p.hasActed = false;
		p.isFolded = false;
	}

	newState.phase = "end_hand";
	newState.currentPlayerSeat = null;
	newState.lastUpdateTime = Date.now();
	newState.handHistory.push("--- Hand End ---");
	return newState;
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

	let newState = applyAction(
		currentGameState,
		validation.playerState,
		action.action,
		action.action === "bet" || action.action === "raise"
			? action.amount
			: undefined,
	);

	const remainingPlayers = Object.values(newState.playerStates).filter(
		(p) => !p.isFolded && !p.isSittingOut,
	);
	if (remainingPlayers.length <= 1) {
		newState.handHistory.push("Only one player remains.");
		newState = determineWinner(newState);
		newState.lastUpdateTime = Date.now();
		return newState;
	}

	const roundOver = isBettingRoundOver(newState);

	if (roundOver) {
		newState.handHistory.push("Betting round concluded.");
		newState.currentPlayerSeat = null;

		if (newState.phase === "river") {
			newState = determineWinner(newState);
		} else if (newState.phase !== "showdown" && newState.phase !== "end_hand") {
			const playersWhoCanContinue = Object.values(newState.playerStates).filter(
				(p) => !p.isFolded && !p.isSittingOut && !p.isAllIn,
			);
			const activePlayersNotFolded = Object.values(
				newState.playerStates,
			).filter((p) => !p.isFolded && !p.isSittingOut);

			if (
				activePlayersNotFolded.length > 1 &&
				playersWhoCanContinue.length > 0
			) {
				newState = dealCommunityCards(newState);

				while (
					newState.phase !== "showdown" &&
					newState.phase !== "end_hand" &&
					isBettingRoundOver(newState)
				) {
					const canActCount = Object.values(newState.playerStates).filter(
						(p) => !p.isFolded && !p.isSittingOut && !p.isAllIn,
					).length;
					const activeCount = Object.values(newState.playerStates).filter(
						(p) => !p.isFolded && !p.isSittingOut,
					).length;

					if (activeCount <= 1) {
						newState = determineWinner(newState);
						break;
					}

					if (canActCount === 0) {
						newState.handHistory.push(
							"All remaining players are all-in. Dealing next street.",
						);
						if (newState.phase === "river") {
							newState = determineWinner(newState);
							break;
						}
						newState = dealCommunityCards(newState);
					} else {
						newState.handHistory.push(
							"Betting round concluded immediately after dealing.",
						);
						if (newState.phase === "river") {
							newState = determineWinner(newState);
							break;
						}
						newState = dealCommunityCards(newState);
					}
				}
				if (newState.phase === "river" && isBettingRoundOver(newState)) {
					newState = determineWinner(newState);
				}
			} else {
				newState = determineWinner(newState);
			}
		}
	} else {
		const lastActorSeat = newState.lastActionPlayerSeat;
		if (lastActorSeat === null) {
			throw new Error(
				"Internal error: lastActionPlayerSeat is null when betting round is not over.",
			);
		}
		newState.currentPlayerSeat = getNextActivePlayerSeat(
			newState,
			lastActorSeat,
		);

		while (newState.currentPlayerSeat) {
			const currentUserIdInActionLoop = Object.keys(newState.playerStates).find(
				(uid) =>
					newState.playerStates[uid].seatNumber === newState.currentPlayerSeat,
			);
			if (
				currentUserIdInActionLoop &&
				newState.playerStates[currentUserIdInActionLoop]?.isAllIn
			) {
				const seatBeforeSkip = newState.currentPlayerSeat;
				newState.currentPlayerSeat = getNextActivePlayerSeat(
					newState,
					newState.currentPlayerSeat,
				);

				if (newState.currentPlayerSeat === newState.lastActionPlayerSeat) {
					if (isBettingRoundOver(newState)) {
						newState.currentPlayerSeat = null;
						newState.handHistory.push("Betting round concluded after skips.");
						if (newState.phase === "river") {
							newState = determineWinner(newState);
						} else if (
							newState.phase !== "showdown" &&
							newState.phase !== "end_hand"
						) {
							newState = dealCommunityCards(newState);
							if (isBettingRoundOver(newState)) {
								if (newState.phase === "river") {
									newState = determineWinner(newState);
								} else if (
									newState.phase !== "showdown" &&
									newState.phase !== "end_hand"
								) {
									// Do nothing, wait for next action or deal
								}
							}
						}
						return newState;
					}
					console.error(
						"Potential loop detected: Next player is the last actor, but round not over.",
					);
					newState.currentPlayerSeat = null;
					break;
				}

				if (newState.currentPlayerSeat === seatBeforeSkip) {
					console.error(
						"Infinite loop detected while skipping all-in players.",
					);
					newState.currentPlayerSeat = null;
					break;
				}
			} else {
				break;
			}
		}

		if (newState.currentPlayerSeat) {
			newState.handHistory.push(
				`Seat ${newState.currentPlayerSeat} is next to act.`,
			);
		} else if (!roundOver) {
			console.warn(
				"Betting round not marked over, but no next player found. Re-evaluating.",
			);
			if (isBettingRoundOver(newState)) {
				newState.handHistory.push("Betting round concluded (late check).");
				if (newState.phase === "river") {
					newState = determineWinner(newState);
				} else if (
					newState.phase !== "showdown" &&
					newState.phase !== "end_hand"
				) {
					newState = dealCommunityCards(newState);
					if (isBettingRoundOver(newState)) {
						if (newState.phase === "river") {
							newState = determineWinner(newState);
						}
					}
				}
			} else {
				console.error(
					"CRITICAL ERROR: Betting round appears ongoing, but cannot determine next player.",
				);
				newState.handHistory.push("Error determining next player.");
			}
		}
	}

	newState.lastUpdateTime = Date.now();
	return newState;
}
