import { useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { useMediaDevices } from '@/features/call/useMediaDevices';
import { SHORTCUT_HELP } from '@/hooks/useKeyboardShortcuts';
import { useSettings, type QualityPreset, type ThemeMode } from '@/store/settings';

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Applies camera/mic/quality changes to the live call. */
  onDeviceChange?: (kind: 'camera' | 'microphone', deviceId: string) => void;
}

export function SettingsModal({ open, onClose, onDeviceChange }: SettingsModalProps) {
  const settings = useSettings();
  const { cameras, microphones, speakers, refresh } = useMediaDevices();

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const deviceOptions = (list: MediaDeviceInfo[], fallback: string) =>
    list.length > 0
      ? list.map((d, i) => ({ value: d.deviceId, label: d.label || `${fallback} ${i + 1}` }))
      : [{ value: '', label: `Default ${fallback.toLowerCase()}` }];

  return (
    <Modal open={open} onClose={onClose} title="Settings" wide>
      <div className="grid max-h-[70vh] gap-6 overflow-y-auto pr-1 sm:grid-cols-2">
        <section className="flex flex-col gap-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Appearance
          </h3>
          <Select
            label="Theme"
            value={settings.theme}
            onChange={(e) => settings.update({ theme: e.target.value as ThemeMode })}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'Follow system' },
            ]}
          />

          <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Devices
          </h3>
          <Select
            label="Camera"
            value={settings.cameraId ?? ''}
            onChange={(e) => {
              settings.update({ cameraId: e.target.value || null });
              if (e.target.value) onDeviceChange?.('camera', e.target.value);
            }}
            options={deviceOptions(cameras, 'Camera')}
          />
          <Select
            label="Microphone"
            value={settings.micId ?? ''}
            onChange={(e) => {
              settings.update({ micId: e.target.value || null });
              if (e.target.value) onDeviceChange?.('microphone', e.target.value);
            }}
            options={deviceOptions(microphones, 'Microphone')}
          />
          <Select
            label="Speaker"
            value={settings.speakerId ?? ''}
            onChange={(e) => settings.update({ speakerId: e.target.value || null })}
            options={deviceOptions(speakers, 'Speaker')}
          />

          <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Video quality
          </h3>
          <Select
            label="Resolution (upper bound)"
            value={settings.quality}
            onChange={(e) => settings.update({ quality: e.target.value as QualityPreset })}
            options={[
              { value: '720p', label: '720p — light on bandwidth' },
              { value: '1080p', label: '1080p — recommended' },
              { value: '1440p', label: '1440p — high' },
              { value: '2160p', label: '4K — maximum (needs strong upload)' },
            ]}
          />
          <Select
            label="Frame rate"
            value={String(settings.frameRate)}
            onChange={(e) => settings.update({ frameRate: Number(e.target.value) as 30 | 60 })}
            options={[
              { value: '30', label: '30 fps' },
              { value: '60', label: '60 fps — smooth motion' },
            ]}
          />
          <p className="text-xs text-ink-faint">
            Resolution and frame-rate changes apply the next time the camera restarts (toggle it
            off/on in-call).
          </p>
        </section>

        <section className="flex flex-col gap-1">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Audio processing
          </h3>
          <Switch
            checked={settings.noiseSuppression}
            onChange={(v) => settings.update({ noiseSuppression: v })}
            label="Noise suppression"
            description="Filters keyboard, fans and background noise"
          />
          <Switch
            checked={settings.echoCancellation}
            onChange={(v) => settings.update({ echoCancellation: v })}
            label="Echo cancellation"
            description="Prevents your speakers feeding back into your mic"
          />

          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Notifications
          </h3>
          <Switch
            checked={settings.notifications}
            onChange={(v) => {
              settings.update({ notifications: v });
              if (v && 'Notification' in window && Notification.permission === 'default') {
                void Notification.requestPermission();
              }
            }}
            label="Chat notifications"
            description="Desktop notification for new messages while the tab is hidden"
          />

          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Keyboard shortcuts
          </h3>
          <ul className="flex flex-col gap-1 text-sm">
            {SHORTCUT_HELP.map((s) => (
              <li key={s.keys} className="flex items-center justify-between">
                <span className="text-ink-dim">{s.action}</span>
                <kbd className="rounded-md border border-line bg-surface-overlay px-2 py-0.5 font-mono text-xs">
                  {s.keys}
                </kbd>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  );
}
