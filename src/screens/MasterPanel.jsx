// src/screens/MasterPanel.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const STATIONS = ['IDLE','BLS','ECG','ALGORITHM','MEGACODE']

export default function MasterPanel() {
  const [mode,          setMode]          = useState('master')  // 'master' | 'admin'
  const [activeStation, setActiveStation] = useState('IDLE')
  const [totalTeams,    setTotalTeams]    = useState(5)
  const [assignments,   setAssignments]   = useState([])
  const [saving,        setSaving]        = useState(false)

  // โหลดสถานะปัจจุบัน
  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('event_state').select('*').single()
      if (data) { setActiveStation(data.active_station); setTotalTeams(data.total_teams_registered) }

      const { data: asgn } = await supabase
        .from('judge_assignments')
        .select('*, teams(team_name), judges(full_name)')
        .eq('status','active')
      setAssignments(asgn || [])
    }
    load()

    // Realtime
    const sub = supabase.channel('event-state')
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'event_state' }, load)
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [])

  async function setStation(station) {
    setSaving(true)
    await supabase.from('event_state').update({ active_station: station }).eq('id', 1)
    setActiveStation(station)
    setSaving(false)
  }

  async function saveTeamCount(n) {
    setTotalTeams(n)
    await supabase.from('event_state').update({ total_teams_registered: n }).eq('id', 1)
  }

  const stationLabel = { IDLE:'ยังไม่เริ่ม', BLS:'BLS', ECG:'ECG', ALGORITHM:'Algorithm', MEGACODE:'Mega Code' }
  const isLive = activeStation !== 'IDLE'

  return (
    <div className="screen-wide" style={{ paddingTop:20 }}>
      {/* สลับโหมด */}
      <div style={{ display:'flex', gap:10, marginBottom:16 }}>
        {[['master','🎛 Master Control'],['admin','🗂 Admin จัดการข้อมูล']].map(([m, label]) => (
          <button key={m} onClick={() => setMode(m)} style={{
            padding:'10px 20px', borderRadius:20,
            border:`1px solid ${mode===m ? 'var(--ecg)' : 'var(--line)'}`,
            background: mode===m ? 'var(--ecg)' : 'var(--bg-panel-2)',
            color: mode===m ? '#04170D' : 'var(--muted)',
            fontFamily:'Sarabun,sans-serif', fontWeight:700, fontSize:15, cursor:'pointer',
          }}>{label}</button>
        ))}
      </div>

      {/* แบนเนอร์เตือน เมื่ออยู่โหมด Admin ระหว่างแข่งสด */}
      {mode === 'admin' && isLive && (
        <div className="warn-banner">
          ⚠ กำลังมีการแข่งขันอยู่ (รอบ {stationLabel[activeStation]}) — โปรดระมัดระวังการแก้ไขข้อมูลที่กำลังใช้งาน
        </div>
      )}

      {/* ===== โหมด MASTER ===== */}
      {mode === 'master' && (
        <div>
          <h1 className="page-title">Master Control</h1>
          <p className="page-sub">กำหนดรอบกิจกรรมที่กำลังแข่งขัน — ทุกจอจะสลับตามอัตโนมัติ</p>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20 }}>
            {['BLS','ECG','ALGORITHM'].map(st => (
              <button key={st} onClick={() => setStation(st)} disabled={saving}
                style={{
                  padding:'24px 12px', borderRadius:12, textAlign:'center',
                  fontFamily:'Sarabun,sans-serif', fontWeight:800, fontSize:18,
                  border:`2px solid ${activeStation===st ? 'var(--ecg)' : 'var(--line)'}`,
                  background: activeStation===st
                    ? 'radial-gradient(120% 140% at 50% 0%,#103324,var(--bg-panel-2))'
                    : 'var(--bg-panel-2)',
                  color: activeStation===st ? 'var(--text)' : 'var(--muted)',
                  cursor:'pointer',
                  boxShadow: activeStation===st ? '0 0 20px -6px var(--ecg)' : 'none',
                }}>{st}</button>
            ))}
          </div>

          <div className="card">
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
              <span className="pulse-dot" />
              <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:13 }}>
                รอบปัจจุบัน: <b style={{color:'var(--text)'}}>{stationLabel[activeStation]}</b>
              </span>
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
              <thead>
                <tr>
                  {['เครื่อง','กรรมการ','ทีม','สถานะ'].map(h => (
                    <th key={h} style={{ textAlign:'left', color:'var(--muted)', fontFamily:'JetBrains Mono,monospace', fontSize:11, padding:'8px 10px', borderBottom:'1px solid var(--line)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assignments.map((a, i) => (
                  <tr key={a.assignment_id}>
                    <td style={{ padding:'10px', borderBottom:'1px solid var(--line)', fontFamily:'JetBrains Mono,monospace', fontSize:12 }}>#{i+1}</td>
                    <td style={{ padding:'10px', borderBottom:'1px solid var(--line)' }}>{a.judges?.full_name}</td>
                    <td style={{ padding:'10px', borderBottom:'1px solid var(--line)', fontWeight:700 }}>{a.teams?.team_name}</td>
                    <td style={{ padding:'10px', borderBottom:'1px solid var(--line)', color:'var(--ecg)', fontFamily:'JetBrains Mono,monospace', fontSize:12 }}>กำลังแข่ง</td>
                  </tr>
                ))}
                {assignments.length === 0 && (
                  <tr><td colSpan={4} style={{ padding:'16px 10px', color:'var(--muted)', fontFamily:'JetBrains Mono,monospace', fontSize:12 }}>ยังไม่มีกรรมการ Login เข้าระบบ</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== โหมด ADMIN (ย่อ — แสดงการตั้งค่าหลัก) ===== */}
      {mode === 'admin' && (
        <div>
          <h1 className="page-title">Admin — จัดการข้อมูล</h1>
          <p className="page-sub">ตั้งค่าก่อนวันแข่งขัน</p>

          <div className="card-highlight">
            <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:11, color:'var(--muted)', marginBottom:10, letterSpacing:'.06em' }}>
              ⚙ จำนวนทีมที่เข้าแข่งขันจริง
            </div>
            <div className="field">
              <label>จำนวนทีม (ใช้คำนวณแต้ม F1 และเกณฑ์คัด Mega Code)</label>
              <select value={totalTeams} onChange={e => saveTeamCount(Number(e.target.value))}>
                {[3,4,5,6].map(n => <option key={n} value={n}>{n} ทีม</option>)}
              </select>
            </div>
            <p className="note">
              แต้ม = N − อันดับ + 1 → {totalTeams} ทีม: อันดับ {Array.from({length:totalTeams},(_,i)=>`${i+1}=${totalTeams-i}`).join(', ')}<br />
              Mega Code: {totalTeams > 3 ? 'คัด 3 ทีมคะแนนสูงสุด' : `ทุกทีมเข้ารอบ (${totalTeams} ทีม)`}
            </p>
          </div>

          <p className="note" style={{ marginTop:16 }}>
            สำหรับจัดการทีม/สมาชิก, กรรมการ, และคลังโจทย์ ECG/Algorithm กรุณาใช้<br />
            <b style={{color:'var(--text)'}}>Supabase Dashboard → Table Editor</b><br />
            โดยตรงในระยะแรกก่อน — จะสร้าง Admin UI เพิ่มเติมในขั้นถัดไป
          </p>
        </div>
      )}
    </div>
  )
}
