// src/screens/MasterPanel.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import AuditTrail from '../components/AuditTrail'

const STATIONS = ['IDLE','BLS','ECG','ALGORITHM','MEGACODE']

export default function MasterPanel() {
  const [mode,          setMode]          = useState('master')
  const [activeStation, setActiveStation] = useState('IDLE')
  const [totalTeams,    setTotalTeams]    = useState(5)
  const [regOpen,       setRegOpen]       = useState(true)
  const [assignments,   setAssignments]   = useState([])
  const [saving,        setSaving]        = useState(false)

  // สำหรับจับคู่ "เครื่อง" กับ "ทีม + กรรมการ" ล่วงหน้า
  const [teams,     setTeams]     = useState([])
  const [judges,    setJudges]    = useState([])
  const [devices,   setDevices]   = useState([]) // [{device_number, team_id, judge_id}]

  async function loadDeviceData() {
    const { data: teamList }  = await supabase.from('teams').select('*').order('team_name')
    const { data: judgeList } = await supabase.from('judges').select('*').order('full_name')
    const { data: devList }   = await supabase.from('device_assignments').select('*').order('device_number')
    setTeams(teamList || [])
    setJudges(judgeList || [])
    setDevices(devList || [])
  }

  async function saveDeviceRow(deviceNumber, field, value) {
    const existing = devices.find(d => d.device_number === deviceNumber)
    const row = { device_number: deviceNumber, team_id: existing?.team_id || null, judge_id: existing?.judge_id || null, [field]: value }
    await supabase.from('device_assignments').upsert(row, { onConflict: 'device_number' })
    loadDeviceData()
  }

  async function loadAll() {
    const { data } = await supabase.from('event_state').select('*').single()
    if (data) {
      setActiveStation(data.active_station)
      setTotalTeams(data.total_teams_registered)
      setRegOpen(data.registration_open)
    }
    const { data: asgn } = await supabase
      .from('judge_assignments')
      .select('*, teams(team_name), judges(full_name)')
      .eq('status', 'active')
    setAssignments(asgn || [])
  }

  useEffect(() => {
    loadAll()
    loadDeviceData()
    const sub = supabase.channel('event-state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_state' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'judge_assignments' }, loadAll)
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

  // เปิด/ปิดการแข่งขัน — ถ้าปิด กรรมการและผู้แข่งขันทุกคนจะเข้าหน้าจอไม่ได้ทันที
  async function toggleRegistration() {
    const next = !regOpen
    setRegOpen(next)
    await supabase.from('event_state').update({ registration_open: next }).eq('id', 1)
  }

  // รีเซ็ต — ปลดล็อกทีมที่ถูกจองผิด ให้กรรมการเลือกใหม่ได้ (แก้ปัญหา "เลือกทีมผิดแล้วออกไม่ได้")
  async function resetAssignment(assignmentId) {
    if (!confirm('ยืนยันรีเซ็ต — ทีมนี้จะถูกปลดล็อกให้เลือกใหม่ได้')) return
    await supabase.from('judge_assignments').delete().eq('assignment_id', assignmentId)
    loadAll()
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

          <div className="card" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div>
              <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:12, color:'var(--muted)' }}>
                สถานะการเข้าถึงระบบ
              </div>
              <div style={{ fontWeight:700, fontSize:16, color: regOpen ? 'var(--ecg)' : 'var(--alert)' }}>
                {regOpen ? '🟢 เปิดใช้งาน — ทุกคนเข้าได้' : '🔴 ปิดใช้งาน — ทุกคนเข้าไม่ได้'}
              </div>
            </div>
            <button onClick={toggleRegistration} style={{
              padding:'12px 24px', borderRadius:10, border:'none', cursor:'pointer',
              fontFamily:'Sarabun,sans-serif', fontWeight:800, fontSize:15,
              background: regOpen ? 'var(--alert)' : 'var(--ecg)',
              color: regOpen ? '#2B0207' : '#04170D',
            }}>
              {regOpen ? '🔒 ปิดการแข่งขัน' : '🔓 เปิดการแข่งขัน'}
            </button>
          </div>

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
                  {['เครื่อง','กรรมการ','ทีม','สถานะ',''].map(h => (
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
                    <td style={{ padding:'10px', borderBottom:'1px solid var(--line)' }}>
                      <button onClick={() => resetAssignment(a.assignment_id)} style={{
                        fontFamily:'JetBrains Mono,monospace', fontSize:11, fontWeight:700,
                        background:'var(--bg-deep)', border:'1px solid var(--alert)', color:'var(--alert)',
                        borderRadius:6, padding:'5px 10px', cursor:'pointer',
                      }}>รีเซ็ต</button>
                    </td>
                  </tr>
                ))}
                {assignments.length === 0 && (
                  <tr><td colSpan={5} style={{ padding:'16px 10px', color:'var(--muted)', fontFamily:'JetBrains Mono,monospace', fontSize:12 }}>ยังไม่มีกรรมการ Login เข้าระบบ</td></tr>
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

          <div className="card-highlight" style={{ marginTop: 16 }}>
            <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:11, color:'var(--muted)', marginBottom:10, letterSpacing:'.06em' }}>
              🖥 จับคู่เครื่อง — ทีม — กรรมการ (ตั้งค่าล่วงหน้า 1 ครั้ง)
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
              <thead>
                <tr>
                  {['เครื่อง #','ทีม','กรรมการ ประจำเครื่อง','ลิงก์กรรมการ','ลิงก์ผู้แข่งขัน'].map(h => (
                    <th key={h} style={{ textAlign:'left', color:'var(--muted)', fontFamily:'JetBrains Mono,monospace', fontSize:11, padding:'8px 10px', borderBottom:'1px solid var(--line)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: totalTeams }, (_, i) => i + 1).map(deviceNum => {
                  const row = devices.find(d => d.device_number === deviceNum) || {}
                  return (
                    <tr key={deviceNum}>
                      <td style={{ padding:'10px', borderBottom:'1px solid var(--line)', fontFamily:'JetBrains Mono,monospace', fontWeight:700 }}>#{deviceNum}</td>
                      <td style={{ padding:'10px', borderBottom:'1px solid var(--line)' }}>
                        <select value={row.team_id || ''} onChange={e => saveDeviceRow(deviceNum, 'team_id', e.target.value)}>
                          <option value="">— เลือกทีม —</option>
                          {teams.map(t => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
                        </select>
                      </td>
                      <td style={{ padding:'10px', borderBottom:'1px solid var(--line)' }}>
                        <select value={row.judge_id || ''} onChange={e => saveDeviceRow(deviceNum, 'judge_id', e.target.value)}>
                          <option value="">— เลือกกรรมการ —</option>
                          {judges.map(j => <option key={j.judge_id} value={j.judge_id}>{j.full_name}</option>)}
                        </select>
                      </td>
                      <td style={{ padding:'10px', borderBottom:'1px solid var(--line)', fontFamily:'JetBrains Mono,monospace', fontSize:11, color:'var(--muted)' }}>
                        /judge?device={deviceNum}
                      </td>
                      <td style={{ padding:'10px', borderBottom:'1px solid var(--line)', fontFamily:'JetBrains Mono,monospace', fontSize:11, color:'var(--muted)' }}>
                        /participant?device={deviceNum}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="note">
              พิมพ์ป้าย "เครื่อง #1, #2, ..." แปะติดที่ Laptop/มือถือแต่ละเครื่องจริง เพื่อกันสับสนหน้างาน<br/>
              กรรมการ/ผู้แข่งขันเปิดลิงก์ตามเครื่องของตัวเองครั้งเดียว ค้างไว้ได้ทั้งวัน ไม่ต้องกดเลือกอะไรอีก
            </p>
          </div>

          <p className="note" style={{ marginTop:16 }}>
            สำหรับจัดการทีม/สมาชิก และคลังโจทย์ ECG/Algorithm กรุณาใช้<br />
            <b style={{color:'var(--text)'}}>Supabase Dashboard → Table Editor</b><br />
            โดยตรงในระยะแรกก่อน — จะสร้าง Admin UI เพิ่มเติมในขั้นถัดไป
          </p>

          <AuditTrail teams={teams} />
        </div>
      )}
    </div>
  )
}
