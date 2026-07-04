import { useEffect } from 'react';
import { useSettings } from '@/store/settings';

/**
 * Applies appearance settings to the document root: the `dark` class from the
 * theme (`system` follows the OS) and the `reduce-motion` class opt-in.
 */
export function useTheme(): void {
  const theme = useSettings((s) => s.theme);
  const reduceMotion = useSettings((s) => s.reduceMotion);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
  }, [reduceMotion]);
}
