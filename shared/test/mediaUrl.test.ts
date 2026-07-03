import { describe, expect, it } from 'vitest';
import { classifyMediaUrl, driveEmbedUrl, parseMediaUrl } from '../src/mediaUrl';

describe('parseMediaUrl', () => {
  it('parses standard YouTube watch URLs', () => {
    const m = parseMediaUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(m?.kind).toBe('youtube');
    expect(m?.providerId).toBe('dQw4w9WgXcQ');
  });

  it('parses youtu.be short links and shorts', () => {
    expect(parseMediaUrl('https://youtu.be/dQw4w9WgXcQ?t=42')?.providerId).toBe('dQw4w9WgXcQ');
    expect(parseMediaUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.providerId).toBe(
      'dQw4w9WgXcQ',
    );
    expect(parseMediaUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')?.kind).toBe('youtube');
  });

  it('rejects lookalike hosts', () => {
    expect(parseMediaUrl('https://evil-youtube.com/watch?v=dQw4w9WgXcQ')?.kind).not.toBe('youtube');
  });

  it('parses Google Drive share links into direct-download URLs', () => {
    const m = parseMediaUrl('https://drive.google.com/file/d/1a2B3c4D5e6F7g8H9/view?usp=sharing');
    expect(m?.kind).toBe('drive');
    expect(m?.providerId).toBe('1a2B3c4D5e6F7g8H9');
    expect(m?.url).toContain('export=download');
    expect(driveEmbedUrl('1a2B3c4D5e6F7g8H9')).toContain('/preview');
  });

  it('classifies direct files, HLS and DASH', () => {
    expect(parseMediaUrl('https://cdn.example.com/movie.mp4')?.kind).toBe('file');
    expect(parseMediaUrl('https://cdn.example.com/movie.webm?sig=abc')?.kind).toBe('file');
    expect(parseMediaUrl('https://cdn.example.com/live/stream.m3u8')?.kind).toBe('hls');
    expect(parseMediaUrl('https://cdn.example.com/vod/manifest.mpd')?.kind).toBe('dash');
  });

  it('rejects non-http protocols and garbage', () => {
    expect(parseMediaUrl('javascript:alert(1)')).toBeNull();
    expect(parseMediaUrl('ftp://example.com/movie.mp4')).toBeNull();
    expect(parseMediaUrl('not a url')).toBeNull();
  });
});

describe('classifyMediaUrl — Drive URL coverage', () => {
  const ID = '1a2B3c4D5e6F7g8H9';
  const shapes = [
    `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
    `https://drive.google.com/file/d/${ID}/preview`,
    `https://drive.google.com/file/d/${ID}/edit`,
    `https://drive.google.com/open?id=${ID}`,
    `https://drive.google.com/uc?id=${ID}&export=download`,
    `https://drive.google.com/uc?export=view&id=${ID}`,
    `https://docs.google.com/uc?id=${ID}`,
    `https://drive.usercontent.google.com/download?id=${ID}&export=download`,
  ];

  it.each(shapes)('detects the file id in %s', (shape) => {
    const r = classifyMediaUrl(shape);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.media.kind).toBe('drive');
      expect(r.media.providerId).toBe(ID);
    }
  });

  it('rejects Drive folders with a specific reason', () => {
    const r = classifyMediaUrl('https://drive.google.com/drive/folders/1AbCdEfGhIjKl');
    expect(r).toEqual({ ok: false, reason: 'drive-not-a-file' });
  });
});

describe('classifyMediaUrl — specific rejections', () => {
  it('explains YouTube links without a video', () => {
    expect(classifyMediaUrl('https://www.youtube.com/playlist?list=PL123abc')).toEqual({
      ok: false,
      reason: 'youtube-no-video',
    });
    expect(classifyMediaUrl('https://www.youtube.com/@somechannel')).toEqual({
      ok: false,
      reason: 'youtube-no-video',
    });
  });

  it('distinguishes bad URLs from bad protocols', () => {
    expect(classifyMediaUrl('not a url')).toEqual({ ok: false, reason: 'invalid-url' });
    expect(classifyMediaUrl('ftp://x.com/a.mp4')).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    });
  });
});
