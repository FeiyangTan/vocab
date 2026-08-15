/**
 * How many items one `POST /api/inbox/process` handles at most.
 *
 * Not an arbitrary number: cram too many into one call and Claude's output gets longer
 * and more error-prone, and it runs up against the `max_tokens` ceiling.
 *
 * The frontend needs this number too — the button has to say honestly "this handles
 * 10 at a time", rather than showing the total waiting to be processed.
 */
export const PROCESS_BATCH_SIZE = 10;

/**
 * How many items one bulk confirm handles at most.
 *
 * Chunking isn't for performance (a few hundred rows in one transaction is fine), it's so
 * the request body doesn't get huge, the transaction doesn't run long, **and progress stays
 * visible** — 135 items = 2 requests, so the counter jumps from 100 to 135.
 */
export const CONFIRM_BATCH_SIZE = 100;
