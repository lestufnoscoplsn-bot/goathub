export function Logo({ size = 40 }: { size?: number }) {
  return (
    <div className="grid shrink-0 place-items-center rounded-[30%] bg-gradient-to-br from-[#7b4dff] to-[#c43be8] shadow-glow" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" width={size * 0.66} height={size * 0.66} aria-hidden>
        <g fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 13c-6-1-10 2-11 7 3-3 7-3 10-1" /><path d="M31 13c6-1 10 2 11 7-3-3-7-3-10-1" />
        </g>
        <path d="M15 19h18l-3 13-6 5-6-5z" fill="#fff" />
        <circle cx="20" cy="24" r="1.7" fill="#7b4dff" /><circle cx="28" cy="24" r="1.7" fill="#7b4dff" />
      </svg>
    </div>
  );
}
