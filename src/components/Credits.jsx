// src/components/Credits.jsx
export default function Credits() {
  return (
    <div style={{
      textAlign: 'center', fontFamily: 'JetBrains Mono,monospace', fontSize: 11,
      color: 'var(--muted)', padding: '20px 0 10px', lineHeight: 1.8,
    }}>
      ออกแบบและติดตั้งโดย ชาญณรงค์ ประสารกก + ทีมงาน QSHC CPR<br/>
      พัฒนาโค้ดโดย Claude (Anthropic) + Codex (OpenAI)
    </div>
  )
}
