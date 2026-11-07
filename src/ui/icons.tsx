const PATHS: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  store: 'M4 9l1.5-5h13L20 9M4 9a2.5 2.5 0 005 0 2.5 2.5 0 006 0 2.5 2.5 0 005 0M5 12v8h14v-8',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
  calc: 'M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01',
  upload: 'M12 15V3M7 8l5-5 5 5M4 15v4h16v-4',
  download: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  pdf: 'M7 3h7l5 5v13H7zM14 3v5h5M9.5 14h5M9.5 17h5',
  sheet: 'M5 3h14v18H5zM5 9h14M5 15h14M11 3v18',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  copy: 'M8 8h12v12H8zM16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  alert: 'M12 4l10 17H2zM12 10v5M12 18h.01',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v5M12 8h.01',
  save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  chevron: 'M9 6l6 6-6 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  columns: 'M4 4h16v16H4zM9 4v16M15 4v16',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
