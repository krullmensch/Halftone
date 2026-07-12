import { useRef } from 'react';

interface Props {
  onAddFiles: (files: File[]) => void;
}

export default function VideoUpload({ onAddFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) onAddFiles(Array.from(files));
    e.target.value = '';
  }

  return (
    <button
      type="button"
      className="canvas-upload"
      onClick={() => inputRef.current?.click()}
    >
      <svg className="canvas-upload__icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
        <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      <span className="canvas-upload__title">Video oder Bilder hochladen</span>
      <span className="canvas-upload__hint">Hierher ziehen oder klicken zum Auswählen</span>
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,.mp4,.mov,.webm,.mkv,.avi,image/jpeg,image/png,image/webp,image/tiff,.tif,.tiff"
        multiple
        onChange={handleChange}
        className="canvas-upload__input"
      />
    </button>
  );
}
