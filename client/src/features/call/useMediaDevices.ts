import { useCallback, useEffect, useState } from 'react';

export interface DeviceLists {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
  refresh: () => Promise<void>;
}

/** Enumerates devices and stays current as hardware is plugged/unplugged. */
export function useMediaDevices(): DeviceLists {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list);
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, [refresh]);

  return {
    cameras: devices.filter((d) => d.kind === 'videoinput'),
    microphones: devices.filter((d) => d.kind === 'audioinput'),
    speakers: devices.filter((d) => d.kind === 'audiooutput'),
    refresh,
  };
}
