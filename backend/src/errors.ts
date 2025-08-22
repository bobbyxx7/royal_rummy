// Central error codes registry
export const ErrorCodes = {
  SUCCESS: 200,
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  INSUFFICIENT_WALLET: 402,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];


