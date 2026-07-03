import { cn } from '@/lib/utils';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-between gap-4 py-2',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-ink-faint">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200',
          checked ? 'bg-accent' : 'bg-line',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-200',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
        />
      </button>
    </label>
  );
}
