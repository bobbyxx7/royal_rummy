import { logSocket } from '../logger';

// Card representation: "H1" = Hearts Ace, "D10" = Diamonds 10, etc.
export type CardCode = string;

// Teen Patti hand rankings (highest to lowest)
export enum HandRank {
  TRAIL = 'trail',           // Three of a kind (e.g., 3 Aces)
  PURE_SEQUENCE = 'pure_sequence', // Three consecutive cards of same suit (e.g., H1, H2, H3)
  SEQUENCE = 'sequence',     // Three consecutive cards (e.g., H1, D2, S3)
  COLOR = 'color',           // Three cards of same suit (e.g., H1, H5, H9)
  PAIR = 'pair',             // Two cards of same rank (e.g., H1, D1)
  HIGH_CARD = 'high_card'    // Highest card wins
}

// Card ranks for comparison (Ace is highest)
export const CARD_RANKS: Record<string, number> = {
  '1': 14,  // Ace
  '13': 13, // King
  '12': 12, // Queen
  '11': 11, // Jack
  '10': 10,
  '9': 9,
  '8': 8,
  '7': 7,
  '6': 6,
  '5': 5,
  '4': 4,
  '3': 3,
  '2': 2
};

// Card suits for comparison
export const CARD_SUITS: Record<string, number> = {
  'S': 4, // Spades (highest)
  'H': 3, // Hearts
  'D': 2, // Diamonds
  'C': 1  // Clubs (lowest)
};

/**
 * Parse card code to suit and rank
 * @param cardCode - Card code like "H1", "D10", "S13"
 * @returns Object with suit and rank
 */
export function parseCardCode(cardCode: CardCode): { suit: string; rank: string } {
  if (!cardCode || cardCode.length < 2) {
    throw new Error(`Invalid card code: ${cardCode}`);
  }

  const suit = cardCode[0];
  const rank = cardCode.slice(1);

  if (!['H', 'D', 'C', 'S'].includes(suit)) {
    throw new Error(`Invalid suit: ${suit}`);
  }

  if (!CARD_RANKS[rank]) {
    throw new Error(`Invalid rank: ${rank}`);
  }

  return { suit, rank };
}

/**
 * Get card rank value for comparison
 * @param cardCode - Card code
 * @returns Numeric rank value
 */
export function getCardRankValue(cardCode: CardCode): number {
  const { rank } = parseCardCode(cardCode);
  return CARD_RANKS[rank];
}

/**
 * Get card suit value for comparison
 * @param cardCode - Card code
 * @returns Numeric suit value
 */
export function getCardSuitValue(cardCode: CardCode): number {
  const { suit } = parseCardCode(cardCode);
  return CARD_SUITS[suit];
}

/**
 * Check if three cards form a trail (three of a kind)
 * @param cards - Array of 3 card codes
 * @returns True if trail, false otherwise
 */
export function isTrail(cards: CardCode[]): boolean {
  if (cards.length !== 3) return false;
  
  const ranks = cards.map(getCardRankValue);
  return ranks[0] === ranks[1] && ranks[1] === ranks[2];
}

/**
 * Check if three cards form a pure sequence (consecutive same suit)
 * @param cards - Array of 3 card codes
 * @returns True if pure sequence, false otherwise
 */
export function isPureSequence(cards: CardCode[]): boolean {
  if (cards.length !== 3) return false;
  
  const cardInfo = cards.map(parseCardCode);
  const suits = cardInfo.map(c => c.suit);
  const ranks = cards.map(getCardRankValue);
  
  // All cards must be same suit
  if (suits[0] !== suits[1] || suits[1] !== suits[2]) return false;
  
  // Check for Ace-low sequence (A-2-3)
  if (ranks.includes(14) && ranks.includes(2) && ranks.includes(3)) {
    return true;
  }
  
  // Ranks must be consecutive
  ranks.sort((a, b) => a - b);
  const isConsecutive = ranks[1] === ranks[0] + 1 && ranks[2] === ranks[1] + 1;
  
  return isConsecutive;
}

/**
 * Check if three cards form a sequence (consecutive, any suit)
 * @param cards - Array of 3 card codes
 * @returns True if sequence, false otherwise
 */
export function isSequence(cards: CardCode[]): boolean {
  if (cards.length !== 3) return false;
  
  const ranks = cards.map(getCardRankValue);
  
  // Check for Ace-low sequence (A-2-3)
  if (ranks.includes(14) && ranks.includes(2) && ranks.includes(3)) {
    return true;
  }
  
  ranks.sort((a, b) => a - b);
  return ranks[1] === ranks[0] + 1 && ranks[2] === ranks[1] + 1;
}

/**
 * Check if three cards are of same color (same suit)
 * @param cards - Array of 3 card codes
 * @returns True if same color, false otherwise
 */
export function isColor(cards: CardCode[]): boolean {
  if (cards.length !== 3) return false;
  
  const suits = cards.map(parseCardCode).map(c => c.suit);
  return suits[0] === suits[1] && suits[1] === suits[2];
}

/**
 * Check if three cards contain a pair
 * @param cards - Array of 3 card codes
 * @returns True if pair exists, false otherwise
 */
export function isPair(cards: CardCode[]): boolean {
  if (cards.length !== 3) return false;
  
  const ranks = cards.map(getCardRankValue);
  return ranks[0] === ranks[1] || ranks[1] === ranks[2] || ranks[0] === ranks[2];
}

/**
 * Evaluate a Teen Patti hand and return its rank and details
 * @param cards - Array of 3 card codes
 * @returns Object with hand rank and additional details
 */
export function evaluateTeenPattiHand(cards: CardCode[]): {
  rank: HandRank;
  value: number;
  details: {
    primaryValue: number;
    secondaryValue: number;
    tertiaryValue: number;
    suitValue: number;
  };
} {
  if (cards.length !== 3) {
    throw new Error('Teen Patti hand must contain exactly 3 cards');
  }

  // Validate all cards
  cards.forEach(parseCardCode);

  // Check for Trail (highest)
  if (isTrail(cards)) {
    const rankValue = getCardRankValue(cards[0]);
    return {
      rank: HandRank.TRAIL,
      value: 1000000 + rankValue * 10000,
      details: {
        primaryValue: rankValue,
        secondaryValue: 0,
        tertiaryValue: 0,
        suitValue: 0
      }
    };
  }

  // Check for Pure Sequence
  if (isPureSequence(cards)) {
    const cardInfo = cards.map(parseCardCode);
    const suit = cardInfo[0].suit;
    const ranks = cards.map(getCardRankValue);
    
    // Handle Ace-low sequence (A-2-3)
    let primaryValue: number;
    if (ranks.includes(14) && ranks.includes(2) && ranks.includes(3)) {
      primaryValue = 3; // For A-2-3, highest is 3
    } else {
      primaryValue = Math.max(...ranks);
    }
    
    const sortedRanks = ranks.sort((a, b) => b - a);
    
    return {
      rank: HandRank.PURE_SEQUENCE,
      value: 900000 + primaryValue * 10000 + CARD_SUITS[suit] * 100,
      details: {
        primaryValue,
        secondaryValue: sortedRanks[1],
        tertiaryValue: sortedRanks[2],
        suitValue: CARD_SUITS[suit]
      }
    };
  }

  // Check for Sequence
  if (isSequence(cards)) {
    const ranks = cards.map(getCardRankValue);
    
    // Handle Ace-low sequence (A-2-3)
    let primaryValue: number;
    if (ranks.includes(14) && ranks.includes(2) && ranks.includes(3)) {
      primaryValue = 3; // For A-2-3, highest is 3
    } else {
      primaryValue = Math.max(...ranks);
    }
    
    const sortedRanks = ranks.sort((a, b) => b - a);
    
    return {
      rank: HandRank.SEQUENCE,
      value: 800000 + primaryValue * 10000 + sortedRanks[1] * 100 + sortedRanks[2],
      details: {
        primaryValue,
        secondaryValue: sortedRanks[1],
        tertiaryValue: sortedRanks[2],
        suitValue: 0
      }
    };
  }

  // Check for Color
  if (isColor(cards)) {
    const cardInfo = cards.map(parseCardCode);
    const suit = cardInfo[0].suit;
    
    // For Color, use actual card values (Ace = 1, not 14)
    const cardValues = cards.map(card => {
      const { rank } = parseCardCode(card);
      return rank === '1' ? 1 : parseInt(rank);
    }).sort((a, b) => b - a);
    
    return {
      rank: HandRank.COLOR,
      value: 700000 + cardValues[0] * 10000 + cardValues[1] * 100 + cardValues[2] + CARD_SUITS[suit] * 10,
      details: {
        primaryValue: cardValues[0],
        secondaryValue: cardValues[1],
        tertiaryValue: cardValues[2],
        suitValue: CARD_SUITS[suit]
      }
    };
  }

  // Check for Pair
  if (isPair(cards)) {
    const ranks = cards.map(getCardRankValue);
    let pairRank: number;
    let kicker: number;
    
    if (ranks[0] === ranks[1]) {
      pairRank = ranks[0];
      kicker = ranks[2];
    } else if (ranks[1] === ranks[2]) {
      pairRank = ranks[1];
      kicker = ranks[0];
    } else {
      pairRank = ranks[0];
      kicker = ranks[1];
    }
    
    return {
      rank: HandRank.PAIR,
      value: 600000 + pairRank * 10000 + kicker,
      details: {
        primaryValue: pairRank,
        secondaryValue: kicker,
        tertiaryValue: 0,
        suitValue: 0
      }
    };
  }

  // High Card (lowest)
  const ranks = cards.map(getCardRankValue).sort((a, b) => b - a);
  const suits = cards.map(parseCardCode).map(c => CARD_SUITS[c.suit]);
  const maxSuit = Math.max(...suits);
  
  return {
    rank: HandRank.HIGH_CARD,
    value: 500000 + ranks[0] * 10000 + ranks[1] * 100 + ranks[2] + maxSuit,
    details: {
      primaryValue: ranks[0],
      secondaryValue: ranks[1],
      tertiaryValue: ranks[2],
      suitValue: maxSuit
    }
  };
}

/**
 * Compare two Teen Patti hands and determine the winner
 * @param hand1 - First hand (array of 3 card codes)
 * @param hand2 - Second hand (array of 3 card codes)
 * @returns 1 if hand1 wins, -1 if hand2 wins, 0 if tie
 */
export function compareTeenPattiHands(hand1: CardCode[], hand2: CardCode[]): number {
  try {
    const evaluation1 = evaluateTeenPattiHand(hand1);
    const evaluation2 = evaluateTeenPattiHand(hand2);
    
    if (evaluation1.value > evaluation2.value) return 1;
    if (evaluation1.value < evaluation2.value) return -1;
    return 0; // Tie
  } catch (error) {
    logSocket('error', { 
      error: 'Error comparing Teen Patti hands', 
      hand1, 
      hand2, 
      details: error instanceof Error ? error.message : String(error)
    });
    return 0; // Return tie on error
  }
}

/**
 * Get the winner from multiple hands
 * @param hands - Array of hands, each containing player info and cards
 * @returns Array of winning player indices (for ties)
 */
export function getTeenPattiWinner(hands: Array<{
  playerId: string;
  cards: CardCode[];
  isBot?: boolean;
}>): string[] {
  if (hands.length === 0) return [];
  if (hands.length === 1) return [hands[0].playerId];

  let winners: string[] = [];
  let bestValue = -1;

  for (let i = 0; i < hands.length; i++) {
    try {
      const evaluation = evaluateTeenPattiHand(hands[i].cards);
      
      if (evaluation.value > bestValue) {
        bestValue = evaluation.value;
        winners = [hands[i].playerId];
      } else if (evaluation.value === bestValue) {
        winners.push(hands[i].playerId);
      }
      } catch (error) {
    logSocket('error', { 
      error: 'Error evaluating hand for winner determination', 
      playerId: hands[i].playerId, 
      cards: hands[i].cards,
      details: error instanceof Error ? error.message : String(error)
    });
  }
  }

  return winners;
}

/**
 * Calculate pot distribution for winners
 * @param winners - Array of winning player IDs
 * @param pot - Total pot amount
 * @param rakePercent - Rake percentage (0-100)
 * @returns Object with winnings per player and rake amount
 */
export function calculateTeenPattiWinnings(
  winners: string[], 
  pot: number, 
  rakePercent: number = 0
): {
  winnings: Record<string, number>;
  rake: number;
  totalDistributed: number;
} {
  const rake = Math.floor((pot * rakePercent) / 100);
  const distributablePot = pot - rake;
  
  if (winners.length === 0) {
    return { winnings: {}, rake, totalDistributed: 0 };
  }
  
  const winningsPerWinner = Math.floor(distributablePot / winners.length);
  const remainder = distributablePot % winners.length;
  
  const winnings: Record<string, number> = {};
  winners.forEach((winnerId, index) => {
    winnings[winnerId] = winningsPerWinner + (index < remainder ? 1 : 0);
  });
  
  return {
    winnings,
    rake,
    totalDistributed: distributablePot
  };
}

/**
 * Validate if a set of cards is valid for Teen Patti
 * @param cards - Array of card codes
 * @returns True if valid, false otherwise
 */
export function validateTeenPattiCards(cards: CardCode[]): boolean {
  if (cards.length !== 3) return false;
  
  try {
    cards.forEach(parseCardCode);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get readable hand description
 * @param cards - Array of 3 card codes
 * @returns Human-readable hand description
 */
export function getTeenPattiHandDescription(cards: CardCode[]): string {
  try {
    const evaluation = evaluateTeenPattiHand(cards);
    const cardInfo = cards.map(parseCardCode);
    
    switch (evaluation.rank) {
      case HandRank.TRAIL:
        const rank = cardInfo[0].rank;
        return `Trail of ${rank === '1' ? 'Aces' : rank === '13' ? 'Kings' : rank === '12' ? 'Queens' : rank === '11' ? 'Jacks' : rank}s`;
      
      case HandRank.PURE_SEQUENCE:
        const suit = cardInfo[0].suit === 'H' ? 'Hearts' : cardInfo[0].suit === 'D' ? 'Diamonds' : cardInfo[0].suit === 'C' ? 'Clubs' : 'Spades';
        return `Pure Sequence in ${suit}`;
      
      case HandRank.SEQUENCE:
        return 'Sequence';
      
      case HandRank.COLOR:
        const colorSuit = cardInfo[0].suit === 'H' ? 'Hearts' : cardInfo[0].suit === 'D' ? 'Diamonds' : cardInfo[0].suit === 'C' ? 'Clubs' : 'Spades';
        return `Color in ${colorSuit}`;
      
      case HandRank.PAIR:
        const pairRank = evaluation.details.primaryValue;
        const pairName = pairRank === 14 ? 'Aces' : pairRank === 13 ? 'Kings' : pairRank === 12 ? 'Queens' : pairRank === 11 ? 'Jacks' : pairRank;
        return `Pair of ${pairName}`;
      
      case HandRank.HIGH_CARD:
        const highRank = evaluation.details.primaryValue;
        const highName = highRank === 14 ? 'Ace' : highRank === 13 ? 'King' : highRank === 12 ? 'Queen' : highRank === 11 ? 'Jack' : highRank;
        return `High Card ${highName}`;
      
      default:
        return 'Unknown Hand';
    }
  } catch (error) {
    return 'Invalid Hand';
  }
}
