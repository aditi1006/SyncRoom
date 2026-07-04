import { describe, expect, it } from 'vitest';
import { Room } from '../src/room';
import { RoomManager } from '../src/roomManager';
import { RateLimiter } from '../src/rateLimiter';

describe('Room membership', () => {
  it('first member becomes host', () => {
    const room = new Room('test-room');
    const a = room.addMember('Alice', 'key-alice-1', 'sock-a');
    const b = room.addMember('Bob', 'key-bob-1', 'sock-b');
    expect(a.participant.isHost).toBe(true);
    expect(b.participant.isHost).toBe(false);
    expect(room.hostId).toBe(a.participant.id);
  });

  it('reclaims identity by participant key (refresh survival)', () => {
    const room = new Room('test-room');
    const a = room.addMember('Alice', 'key-alice-1', 'sock-a');
    const again = room.addMember('Alice', 'key-alice-1', 'sock-a2');
    expect(again.participant.id).toBe(a.participant.id);
    expect(again.socketId).toBe('sock-a2');
    expect(room.members.size).toBe(1);
  });

  it('elects the oldest member as host when host leaves', () => {
    let t = 0;
    const room = new Room('test-room', () => ++t);
    const a = room.addMember('Alice', 'ka-000001', 's1');
    const b = room.addMember('Bob', 'kb-000001', 's2');
    room.addMember('Cara', 'kc-000001', 's3');
    room.removeMember(a.participant.id);
    expect(room.hostId).toBe(b.participant.id);
    expect(room.members.get(b.participant.id)?.participant.isHost).toBe(true);
  });

  it('transfers host explicitly', () => {
    const room = new Room('test-room');
    const a = room.addMember('Alice', 'ka-000001', 's1');
    const b = room.addMember('Bob', 'kb-000001', 's2');
    expect(room.transferHost(b.participant.id)).toBe(true);
    expect(room.isHost(a.participant.id)).toBe(false);
    expect(room.isHost(b.participant.id)).toBe(true);
  });
});

describe('Room playback control', () => {
  it('shared control is the default; host-only blocks guests', () => {
    const room = new Room('test-room');
    const host = room.addMember('Alice', 'ka-000001', 's1');
    const guest = room.addMember('Bob', 'kb-000001', 's2');
    // Default is shared control: everyone can drive playback.
    expect(room.canControlPlayback(host.participant.id)).toBe(true);
    expect(room.canControlPlayback(guest.participant.id)).toBe(true);
    // Host can restrict control back to host-only.
    room.controlMode = 'host-only';
    expect(room.canControlPlayback(host.participant.id)).toBe(true);
    expect(room.canControlPlayback(guest.participant.id)).toBe(false);
  });

  it('setMedia parses URLs and resets playback state', () => {
    const room = new Room('test-room');
    const host = room.addMember('Alice', 'ka-000001', 's1');
    const item = room.setMedia('https://youtu.be/dQw4w9WgXcQ', host.participant.id);
    expect(item?.kind).toBe('youtube');
    expect(room.sync.playing).toBe(false);
    expect(room.sync.time).toBe(0);
    expect(room.setMedia('nonsense', host.participant.id)).toBeNull();
  });

  it('re-anchors time when rate changes mid-play', () => {
    let t = 1_000_000;
    const room = new Room('test-room', () => t);
    room.play(100);
    t += 10_000; // 10s pass at rate 1
    room.setRate(2);
    expect(room.sync.time).toBeCloseTo(110);
    expect(room.sync.rate).toBe(2);
  });
});

describe('Room chat', () => {
  it('only the sender can delete their message', () => {
    const room = new Room('test-room');
    const a = room.addMember('Alice', 'ka-000001', 's1');
    const b = room.addMember('Bob', 'kb-000001', 's2');
    const msg = room.addChat(a.participant.id, 'hello')!;
    expect(room.deleteChat(msg.id, b.participant.id)).toBe(false);
    expect(room.deleteChat(msg.id, a.participant.id)).toBe(true);
    expect(room.chat.find((m) => m.id === msg.id)?.deleted).toBe(true);
    expect(room.chat.find((m) => m.id === msg.id)?.text).toBe('');
  });

  it('tracks read receipts once per reader', () => {
    const room = new Room('test-room');
    const a = room.addMember('Alice', 'ka-000001', 's1');
    const b = room.addMember('Bob', 'kb-000001', 's2');
    const msg = room.addChat(a.participant.id, 'hi')!;
    expect(room.markRead(b.participant.id, [msg.id])).toEqual([msg.id]);
    expect(room.markRead(b.participant.id, [msg.id])).toEqual([]);
  });
});

describe('RoomManager', () => {
  it('creates and rejects duplicate/invalid codes', () => {
    const mgr = new RoomManager();
    expect(mgr.create('movie-night')).not.toBeNull();
    expect(mgr.create('movie-night')).toBeNull();
    expect(mgr.create('BAD CODE')).toBeNull();
    mgr.destroy('movie-night');
    expect(mgr.get('movie-night')).toBeUndefined();
  });
});

describe('RateLimiter', () => {
  it('allows bursts up to capacity then blocks', () => {
    let t = 0;
    const rl = new RateLimiter(() => t);
    for (let i = 0; i < 15; i++) expect(rl.allow('ip1', 'join')).toBe(true);
    expect(rl.allow('ip1', 'join')).toBe(false);
    // refill 0.5/s -> one token after 2s
    t = 2_000;
    expect(rl.allow('ip1', 'join')).toBe(true);
    expect(rl.allow('ip1', 'join')).toBe(false);
  });

  it('keys buckets independently', () => {
    const t = 0;
    const rl = new RateLimiter(() => t);
    for (let i = 0; i < 15; i++) rl.allow('ip1', 'join');
    expect(rl.allow('ip2', 'join')).toBe(true);
  });

  it('sweeps idle buckets', () => {
    let t = 0;
    const rl = new RateLimiter(() => t);
    rl.allow('ip1', 'join');
    t = 11 * 60 * 1000;
    rl.sweep();
    expect(rl.size).toBe(0);
  });
});
