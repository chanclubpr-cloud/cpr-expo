// src/components/Header.jsx
export default function Header() {
  return (
    <header className="site-header">
      <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
        <span className="wordmark-org">QSHC</span>
        <span className="wordmark-title">CPR <span>EXPO</span></span>
        <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:10, color:'var(--muted)', marginLeft:4 }}>
          COMPETENCY ASSESSMENT
        </span>
      </div>
      <div className="header-status">
        <span className="pulse-dot" />
        ONLINE
      </div>
    </header>
  )
}
