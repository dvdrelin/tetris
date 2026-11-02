/**
 * Process identity for the logs.
 *
 * Two matches from two different server restarts have to be tellable apart once their files are
 * side by side: `bad_token` storms, half-written files and "the room vanished" all look different
 * when you can see that the process changed underneath them.
 */
import { randomUUID } from 'crypto'

/** Stable for the lifetime of one backend process, short enough to read in a log line. */
export const BOOT_ID = randomUUID().slice(0, 8)

/** Deploy stamp (Docker build arg). `unknown` only in bare dev/test runs. */
export const RUNTIME_VERSION = process.env.APP_VERSION ?? 'unknown'
