/**
 * Token budgeting and rate limiting utilities
 */

interface TokenUsage {
  tokens: number;
  timestamp: number;
}

interface RateLimitConfig {
  maxTokensPerMinute: number;
  maxTokensPerHour: number;
  maxTokensPerDay: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxTokensPerMinute: 10000,
  maxTokensPerHour: 50000,
  maxTokensPerDay: 200000,
};

class TokenBudgetManager {
  private usageHistory: TokenUsage[] = [];
  private config: RateLimitConfig;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record token usage
   */
  recordUsage(tokens: number): void {
    this.usageHistory.push({
      tokens,
      timestamp: Date.now(),
    });

    // Clean up old entries (older than 24 hours)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.usageHistory = this.usageHistory.filter((entry) => entry.timestamp > oneDayAgo);
  }

  /**
   * Check if token usage is within limits
   */
  checkLimits(tokensToUse: number): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const recentUsage = this.usageHistory.filter((entry) => entry.timestamp > oneMinuteAgo);
    const hourlyUsage = this.usageHistory.filter((entry) => entry.timestamp > oneHourAgo);
    const dailyUsage = this.usageHistory.filter((entry) => entry.timestamp > oneDayAgo);

    const recentTokens = recentUsage.reduce((sum, entry) => sum + entry.tokens, 0);
    const hourlyTokens = hourlyUsage.reduce((sum, entry) => sum + entry.tokens, 0);
    const dailyTokens = dailyUsage.reduce((sum, entry) => sum + entry.tokens, 0);

    if (recentTokens + tokensToUse > this.config.maxTokensPerMinute) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${recentTokens + tokensToUse} tokens in the last minute (max: ${this.config.maxTokensPerMinute})`,
      };
    }

    if (hourlyTokens + tokensToUse > this.config.maxTokensPerHour) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${hourlyTokens + tokensToUse} tokens in the last hour (max: ${this.config.maxTokensPerHour})`,
      };
    }

    if (dailyTokens + tokensToUse > this.config.maxTokensPerDay) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${dailyTokens + tokensToUse} tokens in the last day (max: ${this.config.maxTokensPerDay})`,
      };
    }

    return { allowed: true };
  }

  /**
   * Estimate token count for text (rough approximation: 1 token ≈ 4 characters)
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Get current usage statistics
   */
  getUsageStats(): {
    lastMinute: number;
    lastHour: number;
    lastDay: number;
  } {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    return {
      lastMinute: this.usageHistory
        .filter((entry) => entry.timestamp > oneMinuteAgo)
        .reduce((sum, entry) => sum + entry.tokens, 0),
      lastHour: this.usageHistory
        .filter((entry) => entry.timestamp > oneHourAgo)
        .reduce((sum, entry) => sum + entry.tokens, 0),
      lastDay: this.usageHistory
        .filter((entry) => entry.timestamp > oneDayAgo)
        .reduce((sum, entry) => sum + entry.tokens, 0),
    };
  }

  /**
   * Get current configured hard limits.
   */
  getLimits(): RateLimitConfig {
    return { ...this.config };
  }
}

// Singleton instance
let tokenBudgetManager: TokenBudgetManager | null = null;

export function getTokenBudgetManager(): TokenBudgetManager {
  if (!tokenBudgetManager) {
    const config: Partial<RateLimitConfig> = {};

    // Load from environment variables if available
    if (process.env.MAX_TOKENS_PER_MINUTE) {
      config.maxTokensPerMinute = parseInt(process.env.MAX_TOKENS_PER_MINUTE, 10);
    }
    if (process.env.MAX_TOKENS_PER_HOUR) {
      config.maxTokensPerHour = parseInt(process.env.MAX_TOKENS_PER_HOUR, 10);
    }
    if (process.env.MAX_TOKENS_PER_DAY) {
      config.maxTokensPerDay = parseInt(process.env.MAX_TOKENS_PER_DAY, 10);
    }

    tokenBudgetManager = new TokenBudgetManager(config);
  }
  return tokenBudgetManager;
}
