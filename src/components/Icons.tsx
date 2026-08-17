// Small stroke-icon set for the Broadsheet UI. Kept minimal and hand-drawn
// (no icon library dependency) — 24x24 viewBox, currentColor, 1.8 stroke.

type IconProps = { style?: React.CSSProperties; className?: string };

const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function IconClock({ style, className }: IconProps) {
  return <svg {...base} className={className} style={{ width: 16, height: 16, ...style }}><circle cx="12" cy="12" r="9" /><path d="M12 7v5.3l3.6 2.1" /></svg>;
}
export function IconCheck({ style, className }: IconProps) {
  return <svg {...base} className={className} style={{ width: 16, height: 16, ...style }}><circle cx="12" cy="12" r="9" /><path d="M8 12.3l2.6 2.6L16.2 9" /></svg>;
}
export function IconMail({ style, className }: IconProps) {
  return <svg {...base} className={className} style={{ width: 16, height: 16, ...style }}><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M3.5 6.5 12 13l8.5-6.5" /></svg>;
}
export function IconPin({ style, className }: IconProps) {
  return <svg {...base} className={className} style={{ width: 16, height: 16, ...style }}><path d="M12 21s7-6.3 7-11.5A7 7 0 0 0 5 9.5C5 14.7 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.2" /></svg>;
}
export function IconExternal({ style, className }: IconProps) {
  return <svg {...base} className={className} style={{ width: 16, height: 16, ...style }}><path d="M9 5H5.5A1.5 1.5 0 0 0 4 6.5v12A1.5 1.5 0 0 0 5.5 20h12a1.5 1.5 0 0 0 1.5-1.5V15M14 4h6v6M20 4l-9.5 9.5" /></svg>;
}
export function IconRefresh({ style, className }: IconProps) {
  return <svg {...base} className={className} style={{ width: 16, height: 16, ...style }}><path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.6M4 13a8 8 0 0 0 13.7 4.7L20 15.4" /><path d="M4 4v4.6h4.6M20 20v-4.6h-4.6" /></svg>;
}
export function IconX({ style, className }: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" className={className} style={{ width: 16, height: 16, ...style }}><path d="M5 5l14 14M19 5 5 19" /></svg>;
}
