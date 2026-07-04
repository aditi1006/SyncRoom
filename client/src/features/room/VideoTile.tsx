import { useEffect, useRef } from 'react';
import { Crown, MicOff, PictureInPicture2 } from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { useSettings } from '@/store/settings';
import type { PeerStats } from '@/features/call/useCallStats';

export interface VideoTileProps {
  stream: MediaStream | null;
  name: string;
  isSelf?: boolean;
  isHost?: boolean;
  micOn?: boolean;
  cameraOn?: boolean;
  isScreen?: boolean;
  stats?: PeerStats;
  className?: string;
}

const qualityColor = { good: 'bg-success', fair: 'bg-warning', poor: 'bg-danger' } as const;

export function VideoTile({
  stream,
  name,
  isSelf = false,
  isHost = false,
  micOn = true,
  cameraOn = true,
  isScreen = false,
  stats,
  className,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const speakerId = useSettings((s) => s.speakerId);
  const mirrorVideo = useSettings((s) => s.mirrorVideo);
  const showStats = useSettings((s) => s.showStats);

  useEffect(() => {
    const el = videoRef.current;
    if (el && el.srcObject !== stream) {
      el.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    const el = videoRef.current;
    if (el && !isSelf && speakerId && 'setSinkId' in el) {
      el.setSinkId(speakerId).catch(() => {
        /* device may be gone; browser falls back to default */
      });
    }
  }, [speakerId, isSelf]);

  const showVideo = stream !== null && (cameraOn || isScreen);

  /* Keep the tile playing across PiP transitions. Some browsers pause the
     inline element when it enters/leaves the PiP window; a MediaStream tile
     that isn't playing opens a *paused* PiP window, which reads as "PiP
     paused my video". Re-assert playback whenever the state changes. */
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const resume = (): void => {
      if (el.paused) void el.play().catch(() => {});
    };
    el.addEventListener('enterpictureinpicture', resume);
    el.addEventListener('leavepictureinpicture', resume);
    return () => {
      el.removeEventListener('enterpictureinpicture', resume);
      el.removeEventListener('leavepictureinpicture', resume);
    };
  }, []);

  const pip = async (): Promise<void> => {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement === el) {
        await document.exitPictureInPicture();
        return;
      }
      // A live tile must be actively playing to enter PiP cleanly — a paused
      // element opens a paused PiP window (or throws). Start it first, then
      // keep it playing once the transition completes.
      if (el.paused) await el.play().catch(() => {});
      await el.requestPictureInPicture();
      if (el.paused) void el.play().catch(() => {});
    } catch {
      /* PiP unsupported or blocked — non-fatal */
    }
  };

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl bg-surface-overlay',
        'shadow-lg ring-1 ring-line/60 animate-scale-in',
        className,
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf}
        className={cn(
          'h-full w-full',
          isScreen ? 'object-contain bg-black' : 'object-cover',
          isSelf && !isScreen && mirrorVideo && 'mirror',
          !showVideo && 'invisible',
        )}
      />
      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/20 text-xl font-semibold text-accent">
            {initials(name) || '?'}
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-white">
          {isHost && <Crown size={12} className="shrink-0 text-warning" aria-label="Host" />}
          <span className="truncate">
            {name}
            {isSelf && ' (you)'}
            {isScreen && ' · screen'}
          </span>
          {!micOn && !isScreen && (
            <MicOff size={12} className="shrink-0 text-danger" aria-label="Muted" />
          )}
        </span>
        <span className="flex items-center gap-1.5">
          {showStats && stats && (
            <span
              className={cn('h-2 w-2 rounded-full', qualityColor[stats.quality])}
              title={`RTT ${stats.rttMs}ms · loss ${stats.packetLossPct}% · ${stats.outboundKbps}kbps`}
              aria-label={`Connection ${stats.quality}`}
            />
          )}
          {showVideo && (
            <button
              type="button"
              aria-label={`Picture in picture: ${name}`}
              className="cursor-pointer rounded-md p-1 text-white/70 opacity-0 transition-all hover:text-white group-hover:opacity-100"
              onClick={() => void pip()}
            >
              <PictureInPicture2 size={14} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
