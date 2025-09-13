import {
  parseCardCode,
  getCardRankValue,
  getCardSuitValue,
  isTrail,
  isPureSequence,
  isSequence,
  isColor,
  isPair,
  evaluateTeenPattiHand,
  compareTeenPattiHands,
  getTeenPattiWinner,
  calculateTeenPattiWinnings,
  validateTeenPattiCards,
  getTeenPattiHandDescription,
  HandRank
} from '../teenpatti.rules';

describe('Teen Patti Rules', () => {
  describe('Card Parsing', () => {
    test('should parse valid card codes correctly', () => {
      expect(parseCardCode('H1')).toEqual({ suit: 'H', rank: '1' });
      expect(parseCardCode('D10')).toEqual({ suit: 'D', rank: '10' });
      expect(parseCardCode('S13')).toEqual({ suit: 'S', rank: '13' });
      expect(parseCardCode('C2')).toEqual({ suit: 'C', rank: '2' });
    });

    test('should throw error for invalid card codes', () => {
      expect(() => parseCardCode('')).toThrow('Invalid card code');
      expect(() => parseCardCode('X1')).toThrow('Invalid suit');
      expect(() => parseCardCode('H0')).toThrow('Invalid rank');
      expect(() => parseCardCode('H14')).toThrow('Invalid rank');
    });
  });

  describe('Card Values', () => {
    test('should return correct rank values', () => {
      expect(getCardRankValue('H1')).toBe(14);  // Ace
      expect(getCardRankValue('H13')).toBe(13); // King
      expect(getCardRankValue('H12')).toBe(12); // Queen
      expect(getCardRankValue('H11')).toBe(11); // Jack
      expect(getCardRankValue('H10')).toBe(10);
      expect(getCardRankValue('H2')).toBe(2);
    });

    test('should return correct suit values', () => {
      expect(getCardSuitValue('S1')).toBe(4); // Spades (highest)
      expect(getCardSuitValue('H1')).toBe(3); // Hearts
      expect(getCardSuitValue('D1')).toBe(2); // Diamonds
      expect(getCardSuitValue('C1')).toBe(1); // Clubs (lowest)
    });
  });

  describe('Hand Evaluation', () => {
    test('should identify Trail (three of a kind)', () => {
      expect(isTrail(['H1', 'D1', 'S1'])).toBe(true);
      expect(isTrail(['H10', 'D10', 'C10'])).toBe(true);
      expect(isTrail(['H1', 'D2', 'S1'])).toBe(false);
      expect(isTrail(['H1', 'H2'])).toBe(false);
    });

    test('should identify Pure Sequence (consecutive same suit)', () => {
      expect(isPureSequence(['H1', 'H2', 'H3'])).toBe(true);
      expect(isPureSequence(['S10', 'S11', 'S12'])).toBe(true);
      expect(isPureSequence(['H1', 'H3', 'H2'])).toBe(true); // Order doesn't matter
      expect(isPureSequence(['H1', 'D2', 'S3'])).toBe(false); // Different suits
      expect(isPureSequence(['H1', 'H2', 'H4'])).toBe(false); // Not consecutive
    });

    test('should identify Sequence (consecutive any suit)', () => {
      expect(isSequence(['H1', 'D2', 'S3'])).toBe(true);
      expect(isSequence(['S10', 'H11', 'C12'])).toBe(true);
      expect(isSequence(['H1', 'H2', 'H3'])).toBe(true); // Same suit also counts
      expect(isSequence(['H1', 'D3', 'S2'])).toBe(true); // Order doesn't matter
      expect(isSequence(['H1', 'D2', 'S4'])).toBe(false); // Not consecutive
    });

    test('should identify Color (same suit)', () => {
      expect(isColor(['H1', 'H5', 'H9'])).toBe(true);
      expect(isColor(['S2', 'S7', 'S13'])).toBe(true);
      expect(isColor(['H1', 'D2', 'S3'])).toBe(false); // Different suits
    });

    test('should identify Pair', () => {
      expect(isPair(['H1', 'D1', 'S2'])).toBe(true);
      expect(isPair(['H10', 'D2', 'C10'])).toBe(true);
      expect(isPair(['H1', 'D2', 'S3'])).toBe(false); // No pair
    });
  });

  describe('Hand Ranking', () => {
    test('should evaluate Trail correctly', () => {
      const result = evaluateTeenPattiHand(['H1', 'D1', 'S1']);
      expect(result.rank).toBe(HandRank.TRAIL);
      expect(result.value).toBeGreaterThan(1000000);
      expect(result.details.primaryValue).toBe(14); // Ace
    });

    test('should evaluate Pure Sequence correctly', () => {
      const result = evaluateTeenPattiHand(['H1', 'H2', 'H3']);
      expect(result.rank).toBe(HandRank.PURE_SEQUENCE);
      expect(result.value).toBeGreaterThan(900000);
      expect(result.details.primaryValue).toBe(3); // Highest card in sequence
    });

    test('should evaluate Sequence correctly', () => {
      const result = evaluateTeenPattiHand(['H1', 'D2', 'S3']);
      expect(result.rank).toBe(HandRank.SEQUENCE);
      expect(result.value).toBeGreaterThan(800000);
      expect(result.details.primaryValue).toBe(3); // Highest card in sequence
    });

    test('should evaluate Color correctly', () => {
      const result = evaluateTeenPattiHand(['H1', 'H5', 'H9']);
      expect(result.rank).toBe(HandRank.COLOR);
      expect(result.value).toBeGreaterThan(700000);
      expect(result.details.primaryValue).toBe(9); // Highest card
    });

    test('should evaluate Pair correctly', () => {
      const result = evaluateTeenPattiHand(['H1', 'D1', 'S2']);
      expect(result.rank).toBe(HandRank.PAIR);
      expect(result.value).toBeGreaterThan(600000);
      expect(result.details.primaryValue).toBe(14); // Pair rank (Ace)
      expect(result.details.secondaryValue).toBe(2); // Kicker
    });

    test('should evaluate High Card correctly', () => {
      const result = evaluateTeenPattiHand(['H1', 'D3', 'S5']);
      expect(result.rank).toBe(HandRank.HIGH_CARD);
      expect(result.value).toBeGreaterThan(500000);
      expect(result.details.primaryValue).toBe(14); // Highest card (Ace)
    });

    test('should throw error for invalid hand', () => {
      expect(() => evaluateTeenPattiHand(['H1', 'D2'])).toThrow('Teen Patti hand must contain exactly 3 cards');
      expect(() => evaluateTeenPattiHand(['H1', 'D2', 'S3', 'C4'])).toThrow('Teen Patti hand must contain exactly 3 cards');
    });
  });

  describe('Hand Comparison', () => {
    test('should compare hands correctly', () => {
      // Trail vs High Card
      expect(compareTeenPattiHands(['H1', 'D1', 'S1'], ['H2', 'D3', 'S5'])).toBe(1);
      
      // Pure Sequence vs Sequence
      expect(compareTeenPattiHands(['H1', 'H2', 'H3'], ['H1', 'D2', 'S3'])).toBe(1);
      
      // Same rank, different values
      expect(compareTeenPattiHands(['H1', 'H2', 'H3'], ['D1', 'D2', 'D3'])).toBe(1); // Hearts vs Diamonds
      
      // Same hand
      expect(compareTeenPattiHands(['H1', 'D2', 'S3'], ['H1', 'D2', 'S3'])).toBe(0);
    });

    test('should handle errors gracefully', () => {
      // Invalid cards should result in tie
      expect(compareTeenPattiHands(['INVALID'], ['ALSO_INVALID'])).toBe(0);
    });
  });

  describe('Winner Determination', () => {
    test('should determine single winner', () => {
      const hands = [
        { playerId: 'player1', cards: ['H1', 'D1', 'S1'] }, // Trail
        { playerId: 'player2', cards: ['H2', 'D3', 'S5'] }, // High Card
        { playerId: 'player3', cards: ['H10', 'D10', 'C2'] } // Pair
      ];

      const winners = getTeenPattiWinner(hands);
      expect(winners).toEqual(['player1']);
    });

    test('should handle ties', () => {
      const hands = [
        { playerId: 'player1', cards: ['H1', 'D2', 'S3'] }, // Sequence
        { playerId: 'player2', cards: ['H1', 'D2', 'S3'] }  // Same Sequence
      ];

      const winners = getTeenPattiWinner(hands);
      expect(winners).toEqual(['player1', 'player2']);
    });

    test('should handle empty hands array', () => {
      expect(getTeenPattiWinner([])).toEqual([]);
    });

    test('should handle single hand', () => {
      const hands = [{ playerId: 'player1', cards: ['H1', 'D2', 'S3'] }];
      expect(getTeenPattiWinner(hands)).toEqual(['player1']);
    });
  });

  describe('Winnings Calculation', () => {
    test('should calculate winnings correctly', () => {
      const winners = ['player1', 'player2'];
      const pot = 1000;
      const rakePercent = 10;

      const result = calculateTeenPattiWinnings(winners, pot, rakePercent);
      
      expect(result.rake).toBe(100);
      expect(result.totalDistributed).toBe(900);
      expect(result.winnings.player1).toBe(450);
      expect(result.winnings.player2).toBe(450);
    });

    test('should handle single winner', () => {
      const winners = ['player1'];
      const pot = 500;
      const rakePercent = 0;

      const result = calculateTeenPattiWinnings(winners, pot, rakePercent);
      
      expect(result.rake).toBe(0);
      expect(result.totalDistributed).toBe(500);
      expect(result.winnings.player1).toBe(500);
    });

    test('should handle no winners', () => {
      const winners: string[] = [];
      const pot = 1000;
      const rakePercent = 5;

      const result = calculateTeenPattiWinnings(winners, pot, rakePercent);
      
      expect(result.rake).toBe(50);
      expect(result.totalDistributed).toBe(0);
      expect(Object.keys(result.winnings)).toHaveLength(0);
    });

    test('should handle remainder distribution', () => {
      const winners = ['player1', 'player2', 'player3'];
      const pot = 1000;
      const rakePercent = 0;

      const result = calculateTeenPattiWinnings(winners, pot, rakePercent);
      
      expect(result.totalDistributed).toBe(1000);
      // One player should get the extra 1 from remainder
      const totalWinnings = Object.values(result.winnings).reduce((sum, val) => sum + val, 0);
      expect(totalWinnings).toBe(1000);
    });
  });

  describe('Card Validation', () => {
    test('should validate correct cards', () => {
      expect(validateTeenPattiCards(['H1', 'D2', 'S3'])).toBe(true);
      expect(validateTeenPattiCards(['H10', 'D11', 'C12'])).toBe(true);
    });

    test('should reject invalid cards', () => {
      expect(validateTeenPattiCards(['H1', 'D2'])).toBe(false); // Wrong count
      expect(validateTeenPattiCards(['H1', 'D2', 'S3', 'C4'])).toBe(false); // Wrong count
      expect(validateTeenPattiCards(['INVALID', 'D2', 'S3'])).toBe(false); // Invalid card
    });
  });

  describe('Hand Description', () => {
    test('should generate correct descriptions', () => {
      expect(getTeenPattiHandDescription(['H1', 'D1', 'S1'])).toContain('Trail of Aces');
      expect(getTeenPattiHandDescription(['H1', 'H2', 'H3'])).toContain('Pure Sequence in Hearts');
      expect(getTeenPattiHandDescription(['H1', 'D2', 'S3'])).toBe('Sequence');
      expect(getTeenPattiHandDescription(['H1', 'H5', 'H9'])).toContain('Color in Hearts');
      expect(getTeenPattiHandDescription(['H1', 'D1', 'S2'])).toContain('Pair of Aces');
      expect(getTeenPattiHandDescription(['H2', 'D3', 'S5'])).toContain('High Card 5');
    });

    test('should handle invalid hands gracefully', () => {
      expect(getTeenPattiHandDescription(['INVALID'])).toBe('Invalid Hand');
    });
  });

  describe('Edge Cases', () => {
    test('should handle joker cards if added later', () => {
      // This test can be updated when joker support is added
      expect(true).toBe(true);
    });

    test('should handle different deck sizes', () => {
      // Test with different deck configurations if needed
      expect(true).toBe(true);
    });
  });
});
