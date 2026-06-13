import { useEffect, useRef, useState } from 'react';
import ColorWheel from './ColorWheel';

interface Props {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}

export default function ColorField({ label, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="color-row" ref={ref}>
      <label className={`control-label color-label${disabled ? ' disabled' : ''}`}>
        {label}
      </label>
      <div className="color-field">
        <button
          type="button"
          className="color-swatch"
          style={{ background: value }}
          disabled={disabled}
          onClick={() => setOpen(o => !o)}
          aria-label={`${label} wählen`}
        />
        {open && !disabled && (
          <div className="color-popover">
            <ColorWheel value={value} onChange={onChange} />
            <div className="color-hex">{value.toUpperCase()}</div>
          </div>
        )}
      </div>
    </div>
  );
}
