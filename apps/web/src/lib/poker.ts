import type { Card, HandEvaluationResult, Rank } from "../types";

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

export enum HandRank {
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

export const HAND_RANK_NAMES: Record<HandRank, string> = {
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
		const sortedAvailableCards = sortCards(allCards);
		return {
			rankValue: HandRank.HIGH_CARD,
			rankName:
				allCards.length === 0
					? "No Cards"
					: `Not Enough Cards (Need 5, Have ${allCards.length})`,
			bestHand: sortedAvailableCards.slice(0, 5),
			kickers: sortedAvailableCards.slice(0, 5).map((c) => RANK_VALUES[c.rank]),
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
	if (uniqueRanksSorted.length >= 5) {
		if (uniqueRanksSorted[0] - uniqueRanksSorted[4] === 4) {
			isStraight = true;
			straightHighCard = uniqueRanksSorted[0];
		} else if (
			uniqueRanksSorted[0] === RANK_VALUES.A &&
			uniqueRanksSorted[1] === RANK_VALUES["5"] &&
			uniqueRanksSorted[2] === RANK_VALUES["4"] &&
			uniqueRanksSorted[3] === RANK_VALUES["3"] &&
			uniqueRanksSorted[4] === RANK_VALUES["2"]
		) {
			isStraight = true;
			straightHighCard = 5;

			const ace = sortedHand.find((c) => RANK_VALUES[c.rank] === RANK_VALUES.A);
			if (!ace) {
				throw new Error(
					"Internal Error: Ace not found in hand for Ace-low straight.",
				);
			}
			const lowCards = sortedHand.filter(
				(c) => RANK_VALUES[c.rank] <= RANK_VALUES["5"],
			);
			sortedHand.splice(0, sortedHand.length, ...lowCards, ace);
		}
	}

	if (isFlush && isStraight) {
		const isRoyalFlush =
			straightHighCard === RANK_VALUES.A &&
			uniqueRanksSorted[1] === RANK_VALUES.K;
		const rank = isRoyalFlush ? HandRank.ROYAL_FLUSH : HandRank.STRAIGHT_FLUSH;

		return {
			rankValue: rank,
			rankName: HAND_RANK_NAMES[rank],
			bestHand: sortedHand,
			kickers: [straightHighCard],
		};
	}

	if (counts[0] === 4) {
		const fourRank = uniqueRanksSorted.find((r) => rankCounts[r] === 4);
		const kicker = uniqueRanksSorted.find((r) => r !== fourRank);

		if (fourRank === undefined || kicker === undefined) {
			throw new Error(
				"Internal Error: Could not identify four-of-a-kind or kicker rank.",
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
