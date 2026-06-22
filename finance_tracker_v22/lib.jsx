/* ============================================================
   lib.jsx — icons + reusable SVG charts + small UI atoms
   ============================================================ */
const { useState, useRef, useEffect, useMemo } = React;

/* ---------------- Icons (Lucide-style line icons) ---------------- */
const ICONS = {
  dashboard: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  wallet: "M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5M16 13h.01",
  trending: "M22 7l-8.5 8.5-5-5L2 17M16 7h6v6",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 7l-10 6L2 7",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  plus: "M12 5v14M5 12h14",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  arrowDown: "M12 5v14M5 12l7 7 7-7",
  arrowUpRight: "M7 17L17 7M7 7h10v10",
  arrowRight: "M5 12h14M12 5l7 7-7 7",
  creditCard: "M3 10h18M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  alarm: "M12 9v4l2 2M12 21a8 8 0 100-16 8 8 0 000 16zM5 3L2 6M22 6l-3-3",
  receipt: "M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1zM9 8h6M9 12h6",
  trendingUp: "M3 17l6-6 4 4 7-7M14 8h7v7",
  piggyBank: "M19 10c0-3-3-5-7-5s-7 2-7 5c0 1.5.8 2.8 2 3.7V17h3v-2h2v2h3v-3.3c1.2-.9 2-2.2 2-3.7zM16 9h.01M5 11H3",
  arrowDownRight: "M7 7l10 10M17 7v10H7",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  x: "M18 6 6 18M6 6l12 12",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  sparkles: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM5 3v4M19 17v4M3 5h4M17 19h4",
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z",
  edit: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z",
  target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  repeat: "M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  check: "M20 6 9 17l-5-5",
  filter: "M22 3H2l8 9.5V19l4 2v-8.5L22 3z",
  chevronRight: "M9 18l6-6-6-6",
  chevronLeft: "M15 18l-6-6 6-6",
  chevronDown: "M6 9l6 6 6-6",
  chevronUp: "M18 15l-6-6-6 6",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  pie: "M21.2 15.9A10 10 0 1 1 8.1 2.8M22 12A10 10 0 0 0 12 2v10z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z",
  wand: "M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h0M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  briefcase: "M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",
  creditcard: "M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM2 10h20M6 15h4",
  lightbulb: "M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z",
};
function Icon({ name, size, style, className }) {
  const d = ICONS[name] || "";
  return (
    <svg className={className} width={size || 20} height={size || 20} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      {d.split("M").filter(Boolean).map((seg, i) => <path key={i} d={"M" + seg} />)}
    </svg>
  );
}

/* ---------------- Donut chart ---------------- */
function Donut({ data, size = 180, thickness = 22, center }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = (size - thickness) / 2;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const [hover, setHover] = useState(null);
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={R} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
        {data.map((d, i) => {
          const frac = d.value / total;
          const len = frac * C;
          const seg = (
            <circle key={i} cx={size/2} cy={size/2} r={R} fill="none"
              stroke={d.color} strokeWidth={hover === i ? thickness + 4 : thickness}
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
              strokeLinecap="butt"
              style={{ transition: "stroke-width .15s, opacity .15s", opacity: hover === null || hover === i ? 1 : .35, cursor: "pointer" }}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          );
          offset += len;
          return seg;
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", pointerEvents: "none" }}>
        {hover !== null ? (
          <div>
            <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 700 }}>{data[hover].label}</div>
            <div className="display" style={{ fontSize: 19, fontWeight: 600 }}>{Math.round(data[hover].value / total * 100)}%</div>
          </div>
        ) : center}
      </div>
    </div>
  );
}

/* ---------------- Line / area chart with hover ---------------- */
function LineChart({ points, height = 220, color = "var(--accent)", fmtY, fmtX, currency }) {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  const [hi, setHi] = useState(null);
  useEffect(() => {
    const ro = new ResizeObserver(es => setW(es[0].contentRect.width));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const padX = 8, padTop = 16, padBot = 28;
  const vals = points.map(p => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const innerMin = min - range * 0.12, innerMax = max + range * 0.12;
  const X = i => padX + (i / (points.length - 1 || 1)) * (w - padX * 2);
  const Y = v => padTop + (1 - (v - innerMin) / (innerMax - innerMin)) * (height - padTop - padBot);
  const line = points.map((p, i) => `${i ? "L" : "M"}${X(i)},${Y(p.value)}`).join(" ");
  const area = line + ` L${X(points.length-1)},${height-padBot} L${X(0)},${height-padBot} Z`;
  const gid = "g" + (color.replace(/[^a-z0-9]/gi, "")).slice(0, 8);

  function onMove(e) {
    const r = ref.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    let best = 0, bd = 1e9;
    points.forEach((p, i) => { const d = Math.abs(X(i) - x); if (d < bd) { bd = d; best = i; } });
    setHi(best);
  }
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg width="100%" height={height} onMouseMove={onMove} onMouseLeave={() => setHi(null)} style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={color} fillOpacity="0.06" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <text key={i} x={X(i)} y={height - 8} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text-3)">
            {fmtX ? fmtX(p, i) : ""}
          </text>
        ))}
        {hi !== null && (
          <g>
            <line x1={X(hi)} y1={padTop - 6} x2={X(hi)} y2={height - padBot} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={X(hi)} cy={Y(points[hi].value)} r="5" fill={color} stroke="var(--surface)" strokeWidth="2.5" />
          </g>
        )}
      </svg>
      {hi !== null && (
        <div style={{
          position: "absolute", left: Math.min(Math.max(X(hi) - 60, 0), w - 120), top: 0, width: 120,
          background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 10,
          padding: "8px 10px", pointerEvents: "none", boxShadow: "var(--shadow)",
        }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 700 }}>{fmtX ? fmtX(points[hi], hi) : points[hi].label}</div>
          <div className="display" style={{ fontSize: 16, fontWeight: 600 }}>{fmtY ? fmtY(points[hi].value) : points[hi].value}</div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Grouped bars (income vs expense) ---------------- */
function BarsChart({ data, height = 220, currency }) {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  const [hi, setHi] = useState(null);
  useEffect(() => {
    const ro = new ResizeObserver(es => setW(es[0].contentRect.width));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const max = Math.max(...data.flatMap(d => [d.income, d.expense]), 1);
  const padBot = 26, padTop = 10;
  const groupW = w / data.length;
  const barW = Math.min(16, groupW / 3.2);
  const H = height - padBot - padTop;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg width="100%" height={height} style={{ display: "block" }}>
        {data.map((d, i) => {
          const cx = groupW * i + groupW / 2;
          const ih = (d.income / max) * H, eh = (d.expense / max) * H;
          return (
            <g key={i} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} style={{ cursor: "pointer" }}>
              <rect x={cx - barW - 2} y={padTop + H - ih} width={barW} height={ih} rx="4" fill="var(--pos)" opacity={hi === null || hi === i ? 1 : .4} style={{ transition: "opacity .15s" }} />
              <rect x={cx + 2} y={padTop + H - eh} width={barW} height={eh} rx="4" fill="var(--neg)" opacity={hi === null || hi === i ? 1 : .4} style={{ transition: "opacity .15s" }} />
              <text x={cx} y={height - 8} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text-3)">{d.label}</text>
            </g>
          );
        })}
      </svg>
      {hi !== null && (
        <div style={{ position: "absolute", left: Math.min(groupW * hi, w - 150), top: 0, width: 150, background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 11px", pointerEvents: "none", boxShadow: "var(--shadow)" }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 800, marginBottom: 5 }}>{data[hi].label}</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700 }}><span style={{ color: "var(--pos)" }}>Income</span><span className="num">{FT.fmtShort(data[hi].income, currency)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700 }}><span style={{ color: "var(--neg)" }}>Expense</span><span className="num">{FT.fmtShort(data[hi].expense, currency)}</span></div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Modal shell ---------------- */
function Modal({ title, onClose, children, foot, wide }) {
  useEffect(() => {
    const h = e => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: wide ? 640 : 520, maxHeight: "86vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-h">
          <div className="modal-title">{title}</div>
          <button className="btn btn-icon btn-ghost" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        {children}
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

Object.assign(window, { Icon, Donut, LineChart, BarsChart, Modal });
