/**
 * Per-tab identity. `participantKey` lives in sessionStorage so a refresh
 * reclaims the same participant (server holds a grace window), while two
 * tabs get distinct identities. The display name is remembered per browser.
 */

const KEY_PARTICIPANT = 'syncroom:participant-key';
const KEY_NAME = 'syncroom:display-name';

export function getParticipantKey(): string {
  let key = sessionStorage.getItem(KEY_PARTICIPANT);
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem(KEY_PARTICIPANT, key);
  }
  return key;
}

export function getSavedName(): string {
  return localStorage.getItem(KEY_NAME) ?? '';
}

export function saveName(name: string): void {
  localStorage.setItem(KEY_NAME, name);
}
