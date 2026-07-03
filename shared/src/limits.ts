/** Shared operational limits enforced by the server and reflected in the UI. */
export const LIMITS = {
  /** P2P mesh stays high quality up to this many participants. */
  MAX_PARTICIPANTS: 8,
  MAX_CHAT_LENGTH: 4000,
  /** Attachment cap (bytes) — relayed through the socket, never stored. */
  MAX_ATTACHMENT_BYTES: 10 * 1024 * 1024,
  MAX_QUEUE_ITEMS: 50,
  MAX_CHAT_HISTORY: 500,
  /** Idle rooms are reaped after this many ms with zero participants. */
  ROOM_TTL_EMPTY_MS: 60_000,
  /** Grace period for a refresh/reconnect before a participant is dropped. */
  RECONNECT_GRACE_MS: 15_000,
} as const;
