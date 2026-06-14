import { useRef } from 'react';

interface Props {
  loadFont: (file: File) => void;
}

const ACCEPT = '.woff,.woff2,.ttf,.otf,font/woff,font/woff2,font/ttf,font/otf';

export default function CanvasFontUpload({ loadFont }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadFont(file);
    e.target.value = '';
  }

  return (
    <button
      type="button"
      className="canvas-upload"
      onClick={() => inputRef.current?.click()}
    >
      <svg className="canvas-upload__icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
        <path d="M12 4v16" />
        <path d="M9 20h6" />
      </svg>
      <span className="canvas-upload__title">Font hochladen</span>
      <span className="canvas-upload__hint">woff, woff2, ttf, otf — auch Variable Fonts</span>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={handleChange}
        className="canvas-upload__input"
      />
    </button>
  );
}
