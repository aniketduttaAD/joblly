export class ParseError extends Error {
  constructor(
    message: string,
    public readonly isRetryable: boolean = false
  ) {
    super(message);
    this.name = "ParseError";
  }
}

export function isRetryableError(error: Error): boolean {
  const retryablePatterns = [
    "timeout",
    "rate limit",
    "429",
    "500",
    "502",
    "503",
    "service unavailable",
    "network",
    "ECONNRESET",
    "ETIMEDOUT",
  ];
  return retryablePatterns.some((pattern) => error.message.includes(pattern));
}

export function isNonRetryableError(error: Error): boolean {
  const nonRetryablePatterns = [
    "Empty response",
    "Invalid response structure",
    "content policy",
    "authentication failed",
    "OPENAI_API_KEY is not set",
    "Job description text is empty",
    "must be a string",
    "Response too short",
  ];
  return nonRetryablePatterns.some((pattern) => error.message.includes(pattern));
}
