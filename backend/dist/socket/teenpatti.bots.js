"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BOT_CONFIGS = exports.BotPersonality = exports.BotDifficulty = void 0;
exports.makeBotDecision = makeBotDecision;
exports.createRandomBotConfig = createRandomBotConfig;
exports.getBotStats = getBotStats;
const logger_1 = require("../logger");
const teenpatti_rules_1 = require("./teenpatti.rules");
// Bot difficulty levels
var BotDifficulty;
(function (BotDifficulty) {
    BotDifficulty["EASY"] = "easy";
    BotDifficulty["MEDIUM"] = "medium";
    BotDifficulty["HARD"] = "hard";
})(BotDifficulty || (exports.BotDifficulty = BotDifficulty = {}));
// Bot personality types
var BotPersonality;
(function (BotPersonality) {
    BotPersonality["CONSERVATIVE"] = "conservative";
    BotPersonality["AGGRESSIVE"] = "aggressive";
    BotPersonality["BALANCED"] = "balanced";
    BotPersonality["RANDOM"] = "random"; // Unpredictable behavior
})(BotPersonality || (exports.BotPersonality = BotPersonality = {}));
// Default bot configurations
exports.DEFAULT_BOT_CONFIGS = {
    [BotDifficulty.EASY]: {
        difficulty: BotDifficulty.EASY,
        personality: BotPersonality.CONSERVATIVE,
        bluffFrequency: 0.1,
        raiseFrequency: 0.2,
        foldThreshold: 0.4,
        maxBetMultiplier: 2
    },
    [BotDifficulty.MEDIUM]: {
        difficulty: BotDifficulty.MEDIUM,
        personality: BotPersonality.BALANCED,
        bluffFrequency: 0.3,
        raiseFrequency: 0.4,
        foldThreshold: 0.3,
        maxBetMultiplier: 3
    },
    [BotDifficulty.HARD]: {
        difficulty: BotDifficulty.HARD,
        personality: BotPersonality.AGGRESSIVE,
        bluffFrequency: 0.5,
        raiseFrequency: 0.6,
        foldThreshold: 0.2,
        maxBetMultiplier: 5
    }
};
/**
 * Main bot decision function
 * @param bot - Bot player object
 * @param game - Current game state
 * @param config - Bot configuration
 * @returns Bot action decision
 */
function makeBotDecision(bot, game, config = exports.DEFAULT_BOT_CONFIGS[BotDifficulty.MEDIUM]) {
    try {
        // If bot has folded, no action needed
        if (bot.hasFolded) {
            return { action: 'call', reasoning: 'Bot has already folded' };
        }
        // If it's not bot's turn, no action needed
        if (game.currentTurn !== bot.seatNo) {
            return { action: 'call', reasoning: 'Not bot\'s turn' };
        }
        // Evaluate bot's hand strength
        const handStrength = evaluateBotHandStrength(bot, game, config);
        // Determine action based on hand strength and personality
        const action = determineBotAction(bot, game, handStrength, config);
        // Calculate bet amount if raising
        let amount;
        if (action === 'raise') {
            amount = calculateBotBetAmount(bot, game, handStrength, config);
        }
        // Determine target for show action
        let targetPlayerId;
        if (action === 'show') {
            targetPlayerId = selectShowTarget(bot, game, config);
        }
        const reasoning = generateBotReasoning(bot, action, handStrength, config);
        (0, logger_1.logSocket)('info', {
            event: 'bot-decision',
            botId: bot.userId,
            action,
            amount,
            handStrength: handStrength.level,
            reasoning
        });
        return { action, amount, targetPlayerId, reasoning };
    }
    catch (error) {
        (0, logger_1.logSocket)('error', {
            event: 'bot-decision-error',
            botId: bot.userId,
            error: error.message
        });
        // Default to call on error
        return { action: 'call', reasoning: 'Error occurred, defaulting to call' };
    }
}
/**
 * Evaluate bot's hand strength
 * @param bot - Bot player
 * @param game - Current game state
 * @param config - Bot configuration
 * @returns Hand strength evaluation
 */
function evaluateBotHandStrength(bot, game, config) {
    if (!bot.cards || bot.cards.length !== 3) {
        return { level: 'very_poor', value: 0, rank: 'no_cards', confidence: 0 };
    }
    try {
        const evaluation = (0, teenpatti_rules_1.evaluateTeenPattiHand)(bot.cards);
        const handDescription = (0, teenpatti_rules_1.getTeenPattiHandDescription)(bot.cards);
        // Determine strength level based on hand rank and values
        let level;
        let confidence;
        switch (evaluation.rank) {
            case 'trail':
                level = 'excellent';
                confidence = 0.95;
                break;
            case 'pure_sequence':
                level = 'excellent';
                confidence = 0.9;
                break;
            case 'sequence':
                level = 'good';
                confidence = 0.8;
                break;
            case 'color':
                level = 'good';
                confidence = 0.75;
                break;
            case 'pair':
                level = evaluation.details.primaryValue >= 10 ? 'good' : 'average';
                confidence = evaluation.details.primaryValue >= 10 ? 0.7 : 0.6;
                break;
            case 'high_card':
                level = evaluation.details.primaryValue >= 12 ? 'average' : 'poor';
                confidence = evaluation.details.primaryValue >= 12 ? 0.5 : 0.3;
                break;
            default:
                level = 'very_poor';
                confidence = 0.1;
        }
        // Adjust confidence based on game context
        confidence = adjustConfidenceForContext(bot, game, confidence, config);
        return {
            level,
            value: evaluation.value,
            rank: handDescription,
            confidence
        };
    }
    catch (error) {
        (0, logger_1.logSocket)('error', {
            event: 'bot-hand-evaluation-error',
            botId: bot.userId,
            error: error.message
        });
        return { level: 'very_poor', value: 0, rank: 'evaluation_error', confidence: 0 };
    }
}
/**
 * Adjust confidence based on game context
 * @param bot - Bot player
 * @param game - Current game state
 * @param baseConfidence - Base confidence value
 * @param config - Bot configuration
 * @returns Adjusted confidence value
 */
function adjustConfidenceForContext(bot, game, baseConfidence, config) {
    let adjustedConfidence = baseConfidence;
    // Adjust based on pot size relative to bot's bet
    const potRatio = game.pot / (bot.currentBet || 1);
    if (potRatio > 5) {
        adjustedConfidence *= 0.9; // High pot makes decisions more conservative
    }
    else if (potRatio < 2) {
        adjustedConfidence *= 1.1; // Low pot allows more aggressive play
    }
    // Adjust based on number of active players
    const activePlayers = game.players.filter(p => !p.hasFolded).length;
    if (activePlayers > 4) {
        adjustedConfidence *= 0.85; // More players = more uncertainty
    }
    else if (activePlayers === 2) {
        adjustedConfidence *= 1.15; // Heads-up = more confidence
    }
    // Adjust based on betting round
    if (game.phase === 'seen-betting') {
        adjustedConfidence *= 1.1; // Seen betting allows more informed decisions
    }
    else if (game.phase === 'blind-betting') {
        adjustedConfidence *= 0.9; // Blind betting has more uncertainty
    }
    // Adjust based on bot's personality
    switch (config.personality) {
        case BotPersonality.CONSERVATIVE:
            adjustedConfidence *= 0.9;
            break;
        case BotPersonality.AGGRESSIVE:
            adjustedConfidence *= 1.1;
            break;
        case BotPersonality.RANDOM:
            adjustedConfidence *= 0.8 + Math.random() * 0.4; // Random factor
            break;
    }
    return Math.max(0.1, Math.min(0.95, adjustedConfidence));
}
/**
 * Determine bot action based on hand strength and context
 * @param bot - Bot player
 * @param game - Current game state
 * @param handStrength - Hand strength evaluation
 * @param config - Bot configuration
 * @returns Bot action decision
 */
function determineBotAction(bot, game, handStrength, config) {
    const { level, confidence } = handStrength;
    // Random factor for unpredictability
    const randomFactor = Math.random();
    // Determine base action probability
    let callProb = 0.4;
    let raiseProb = 0.3;
    let packProb = 0.2;
    let showProb = 0.1;
    // Adjust probabilities based on hand strength
    switch (level) {
        case 'excellent':
            callProb = 0.2;
            raiseProb = 0.6;
            packProb = 0.1;
            showProb = 0.1;
            break;
        case 'good':
            callProb = 0.3;
            raiseProb = 0.4;
            packProb = 0.2;
            showProb = 0.1;
            break;
        case 'average':
            callProb = 0.5;
            raiseProb = 0.2;
            packProb = 0.2;
            showProb = 0.1;
            break;
        case 'poor':
            callProb = 0.3;
            raiseProb = 0.1;
            packProb = 0.5;
            showProb = 0.1;
            break;
        case 'very_poor':
            callProb = 0.2;
            raiseProb = 0.05;
            packProb = 0.7;
            showProb = 0.05;
            break;
    }
    // Adjust based on personality
    switch (config.personality) {
        case BotPersonality.CONSERVATIVE:
            callProb *= 1.2;
            raiseProb *= 0.7;
            packProb *= 1.1;
            break;
        case BotPersonality.AGGRESSIVE:
            callProb *= 0.8;
            raiseProb *= 1.3;
            packProb *= 0.8;
            break;
        case BotPersonality.RANDOM:
            // Add more randomness
            callProb += (Math.random() - 0.5) * 0.2;
            raiseProb += (Math.random() - 0.5) * 0.2;
            packProb += (Math.random() - 0.5) * 0.2;
            break;
    }
    // Normalize probabilities
    const total = callProb + raiseProb + packProb + showProb;
    callProb /= total;
    raiseProb /= total;
    packProb /= total;
    showProb /= total;
    // Determine action based on probabilities
    if (randomFactor < callProb)
        return 'call';
    if (randomFactor < callProb + raiseProb)
        return 'raise';
    if (randomFactor < callProb + raiseProb + packProb)
        return 'pack';
    return 'show';
}
/**
 * Calculate bot bet amount for raise action
 * @param bot - Bot player
 * @param game - Current game state
 * @param handStrength - Hand strength evaluation
 * @param config - Bot configuration
 * @returns Bet amount
 */
function calculateBotBetAmount(bot, game, handStrength, config) {
    const baseAmount = game.currentBet;
    const maxAmount = baseAmount * config.maxBetMultiplier;
    // Calculate amount based on hand strength
    let multiplier = 1;
    switch (handStrength.level) {
        case 'excellent':
            multiplier = 2.5 + Math.random() * 1.5; // 2.5x to 4x
            break;
        case 'good':
            multiplier = 1.5 + Math.random() * 1.0; // 1.5x to 2.5x
            break;
        case 'average':
            multiplier = 1.2 + Math.random() * 0.8; // 1.2x to 2x
            break;
        case 'poor':
            multiplier = 1.0 + Math.random() * 0.5; // 1x to 1.5x
            break;
        case 'very_poor':
            multiplier = 1.0; // Minimum raise
            break;
    }
    // Adjust based on personality
    switch (config.personality) {
        case BotPersonality.CONSERVATIVE:
            multiplier *= 0.8;
            break;
        case BotPersonality.AGGRESSIVE:
            multiplier *= 1.3;
            break;
    }
    // Add some randomness
    multiplier += (Math.random() - 0.5) * 0.2;
    const amount = Math.floor(baseAmount * multiplier);
    // Ensure amount is within bounds
    return Math.max(baseAmount + 1, Math.min(amount, maxAmount));
}
/**
 * Select target player for show action
 * @param bot - Bot player
 * @param game - Current game state
 * @param config - Bot configuration
 * @returns Target player ID
 */
function selectShowTarget(bot, game, config) {
    // Find players who haven't folded
    const activePlayers = game.players.filter(p => !p.hasFolded && p.userId !== bot.userId);
    if (activePlayers.length === 0)
        return undefined;
    // Prefer players with lower bets (easier to beat)
    const sortedPlayers = activePlayers.sort((a, b) => (a.currentBet || 0) - (b.currentBet || 0));
    // Add some randomness to selection
    const randomIndex = Math.floor(Math.random() * Math.min(3, sortedPlayers.length));
    return sortedPlayers[randomIndex].userId;
}
/**
 * Generate reasoning for bot's decision
 * @param bot - Bot player
 * @param action - Bot's action
 * @param handStrength - Hand strength evaluation
 * @param config - Bot configuration
 * @returns Reasoning string
 */
function generateBotReasoning(bot, action, handStrength, config) {
    const { level, rank, confidence } = handStrength;
    const reasons = {
        call: [
            `Confident in ${rank} (${level} hand)`,
            `Pot odds justify continuing`,
            `Waiting for better opportunities`,
            `Maintaining position in game`
        ],
        raise: [
            `Strong ${rank} (${level} hand)`,
            `Building the pot with confidence`,
            `Applying pressure to opponents`,
            `Capitalizing on hand strength`
        ],
        pack: [
            `Weak ${rank} (${level} hand)`,
            `Pot odds don't justify continuing`,
            `Cutting losses early`,
            `Waiting for better hands`
        ],
        show: [
            `Challenging opponent with ${rank}`,
            `Confident in hand strength`,
            `Testing opponent's resolve`,
            `Strategic move to gain information`
        ]
    };
    const actionReasons = reasons[action] || reasons.call;
    const randomReason = actionReasons[Math.floor(Math.random() * actionReasons.length)];
    return `${randomReason} (Confidence: ${Math.round(confidence * 100)}%)`;
}
/**
 * Create a bot with random configuration
 * @returns Bot configuration
 */
function createRandomBotConfig() {
    const difficulties = Object.values(BotDifficulty);
    const personalities = Object.values(BotPersonality);
    const difficulty = difficulties[Math.floor(Math.random() * difficulties.length)];
    const personality = personalities[Math.floor(Math.random() * personalities.length)];
    const config = { ...exports.DEFAULT_BOT_CONFIGS[difficulty] };
    config.personality = personality;
    // Add some randomness to parameters
    config.bluffFrequency += (Math.random() - 0.5) * 0.2;
    config.raiseFrequency += (Math.random() - 0.5) * 0.2;
    config.foldThreshold += (Math.random() - 0.5) * 0.2;
    config.maxBetMultiplier += (Math.random() - 0.5) * 1;
    // Ensure values are within bounds
    config.bluffFrequency = Math.max(0, Math.min(1, config.bluffFrequency));
    config.raiseFrequency = Math.max(0, Math.min(1, config.raiseFrequency));
    config.foldThreshold = Math.max(0, Math.min(1, config.foldThreshold));
    config.maxBetMultiplier = Math.max(1, config.maxBetMultiplier);
    return config;
}
/**
 * Get bot statistics for monitoring
 * @param botId - Bot player ID
 * @param game - Current game state
 * @returns Bot statistics
 */
function getBotStats(botId, game) {
    const bot = game.players.find(p => p.userId === botId);
    if (!bot) {
        return {
            totalBets: 0,
            totalRaises: 0,
            totalPacks: 0,
            totalShows: 0,
            averageBetAmount: 0,
            winRate: 0
        };
    }
    // This would typically track stats over multiple games
    // For now, return basic current game stats
    return {
        totalBets: bot.totalBet,
        totalRaises: bot.lastAction === 'raise' ? 1 : 0,
        totalPacks: bot.hasFolded ? 1 : 0,
        totalShows: bot.lastAction === 'show' ? 1 : 0,
        averageBetAmount: bot.totalBet,
        winRate: 0 // Would need to track across games
    };
}
