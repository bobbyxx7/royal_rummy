## Error Codes and Meanings

- 200: Success
- 400: Invalid request (schema validation failed or missing fields)
- 401: Unauthorized (token missing/invalid)
- 402: Payment required / insufficient wallet (contextual)
- 404: Not found (table/game/seat)
- 409: Conflict (not your turn, already drew, table full, packed user action)
- 500: Server error

Socket events return `{ code, message, ... }` with additional context fields.


