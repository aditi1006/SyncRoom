import { useCallback, useEffect, useState, type RefObject } from 'react';

export function useFullscreen(target: RefObject<HTMLElement | null>): {
  isFullscreen: boolean;
  toggle: () => void;
} {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = (): void => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback((): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void (target.current ?? document.documentElement).requestFullscreen();
    }
  }, [target]);

  return { isFullscreen, toggle };
}
