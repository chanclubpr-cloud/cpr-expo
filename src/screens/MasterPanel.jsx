// src/screens/MasterPanel.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import AuditTrail from '../components/AuditTrail'
import TeamJudgeManager from '../components/TeamJudgeManager'
import MegaCodeSettings from '../components/MegaCodeSettings'
import MegaCodeScoring from '../components/MegaCodeScoring'
import BLSRankingManager from '../components/BLSRankingManager'
import ForceFinishTool from '../components/ForceFinishTool'
import ParticipantManager from '../components/ParticipantManager'
import QuestionManager from '../components/QuestionManager'

const STATIONS = ['IDLE','BLS','ECG','ALGORITHM','MEGACODE']

export default function MasterPanel() {
  const [mode,          setMode]          = useState('master')
  const [activeStation, setActiveStation] = useState('IDLE')
  const [totalTeams,    setTotalTeams]    = useState(5)
  const [regOpen,       setRegOpen]       = useState(true)
  const [assignments,   setAssignments]   = useState([])
  const [saving,        setSaving]        = useState(false)
  const [resetTarget,   setResetTarget]   = useState('BLS') // ฐานที่เลือกจะรีเซ็ต

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
    // ป้องกันกดพลาดสลับฐานระหว่างแข่งขันสด — ถ้ากำลังมีรอบอื่นดำเนินอยู่ (ไม่ใช่ IDLE)
    // และกดฐานที่ต่างจากฐานเดิม ให้ถามยืนยันก่อนเสมอ
    if (activeStation !== 'IDLE' && activeStation !== station) {
      const ok = confirm(
        `⚠️ กำลังมีการแข่งขันฐาน "${activeStation}" อยู่\n\n` +
        `ยืนยันเปลี่ยนเป็นฐาน "${station}" ใช่หรือไม่?\n` +
        `ทุกจอกรรมการ/ผู้แข่งขันจะสลับหน้าจอทันที`
      )
      if (!ok) return
    }

    setSaving(true)
    const { error } = await supabase.from('event_state').update({ active_station: station }).eq('id', 1)
    if (error) {
      alert(`เปลี่ยนฐานไม่สำเร็จ: ${error.message}\n\nกรุณาแจ้งผู้ดูแลระบบ (อาจเป็นปัญหาสิทธิ์การเขียนฐานข้อมูล)`)
      setSaving(false)
      return
    }
    setActiveStation(station) // อัปเดตหน้าจอเฉพาะเมื่อบันทึกลงฐานข้อมูลสำเร็จจริงเท่านั้น
    setSaving(false)
  }

  async function saveTeamCount(n) {
    const { error } = await supabase.from('event_state').update({ total_teams_registered: n }).eq('id', 1)
    if (error) {
      alert(`บันทึกจำนวนทีมไม่สำเร็จ: ${error.message}`)
      return
    }
    setTotalTeams(n)
  }

  // เปิด/ปิดการแข่งขัน — ถ้าปิด กรรมการและผู้แข่งขันทุกคนจะเข้าหน้าจอไม่ได้ทันที
  async function toggleRegistration() {
    const next = !regOpen
    const { error } = await supabase.from('event_state').update({ registration_open: next }).eq('id', 1)
    if (error) {
      alert(`เปลี่ยนสถานะไม่สำเร็จ: ${error.message}`)
      return
    }
    setRegOpen(next)
  }

  // รีเซ็ต — ปลดล็อกทีมที่ถูกจองผิด ให้กรรมการเลือกใหม่ได้ (แก้ปัญหา "เลือกทีมผิดแล้วออกไม่ได้")
  async function resetAssignment(assignmentId) {
    if (!confirm('ยืนยันรีเซ็ต — ทีมนี้จะถูกปลดล็อกให้เลือกใหม่ได้')) return
    await supabase.from('judge_assignments').delete().eq('assignment_id', assignmentId)
    loadAll()
  }

  // รีเซ็ตกลับไป "ยังไม่เริ่ม" ทั้งหมด — ใช้เมื่อต้องแข่งใหม่ทั้งงาน (ล้างคิว/ผลคะแนน/การจับคู่กรรมการ)
  // ข้อมูลทีม/กรรมการ/โจทย์/การจับคู่เครื่อง จะไม่ถูกลบ
  async function resetCompetition(stationFilter) {
    const isAll = stationFilter === 'ALL'
    const label = isAll ? 'ทุกฐาน (ทั้งงาน)' : stationFilter

    if (!confirm(
      `ยืนยันรีเซ็ต${isAll ? 'การแข่งขันทั้งหมด' : `เฉพาะฐาน "${stationFilter}"`}?\n\n` +
      `จะล้าง: คิวปัจจุบัน, ผลคะแนน, การจับคู่กรรมการ-ทีมของ${label}\n` +
      `จะไม่ลบ: ชื่อทีม/กรรมการ/ผู้เข้าแข่งขัน, คลังโจทย์, การจับคู่เครื่อง\n\n` +
      (isAll ? 'จะรีเซ็ตสถานะกลับเป็น "ยังไม่เริ่ม" ด้วย' : 'ฐานอื่นและรอบกิจกรรมปัจจุบันจะไม่ถูกแตะต้อง')
    )) return

    let e1, e2, e3, e4

    if (isAll) {
      ;({ error: e1 } = await supabase.from('attempts').delete().neq('attempt_id', '00000000-0000-0000-0000-000000000000'))
      ;({ error: e2 } = await supabase.from('judge_assignments').delete().neq('assignment_id', '00000000-0000-0000-0000-000000000000'))
      ;({ error: e3 } = await supabase.from('station_results').delete().neq('result_id', '00000000-0000-0000-0000-000000000000'))
      ;({ error: e4 } = await supabase.from('megacode_qualifiers').delete().neq('team_id', '00000000-0000-0000-0000-000000000000'))
      await supabase.from('event_state').update({ active_station: 'IDLE', registration_open: true }).eq('id', 1)
    } else {
      // รีเซ็ตเฉพาะฐานที่เลือก — ไม่แตะฐานอื่นและไม่เปลี่ยนรอบกิจกรรมปัจจุบัน
      const { data: asgnRows } = await supabase
        .from('judge_assignments').select('assignment_id').eq('station_type', stationFilter)
      const assignmentIds = (asgnRows || []).map(a => a.assignment_id)

      if (assignmentIds.length > 0) {
        ;({ error: e1 } = await supabase.from('attempts').delete().in('assignment_id', assignmentIds))
      }
      ;({ error: e2 } = await supabase.from('judge_assignments').delete().eq('station_type', stationFilter))
      ;({ error: e3 } = await supabase.from('station_results').delete().eq('station_type', stationFilter))
    }

    const firstError = e1 || e2 || e3 || e4
    if (firstError) {
      alert(`รีเซ็ตไม่สำเร็จบางส่วน: ${firstError.message}`)
    } else {
      alert(`รีเซ็ต${isAll ? 'การแข่งขันทั้งหมด' : `ฐาน "${stationFilter}"`}เรียบร้อยแล้ว`)
    }
    loadAll()
  }

  const stationLabel = { IDLE:'ยังไม่เริ่ม', BLS:'BLS', ECG:'ECG', ALGORITHM:'Algorithm', MEGACODE:'Mega Code' }
  const isLive = activeStation !== 'IDLE'

  const tabStyle = (m) => ({
    padding:'10px 20px', borderRadius:20,
    border:`1px solid ${mode===m ? 'var(--ecg)' : 'var(--line)'}`,
    background: mode===m ? 'var(--ecg)' : 'var(--bg-panel-2)',
    color: mode===m ? '#04170D' : 'var(--muted)',
    fontFamily:'Sarabun,sans-serif', fontWeight:700, fontSize:15, cursor:'pointer',
  })

  return (
    <div className="screen-wide" style={{ paddingTop:20 }}>
      {/* สลับโหมด — จัด 3 กลุ่ม: ซ้าย(Admin/Master) กลาง(BLS/MegaCode) ขวา(ตรวจสอบย้อนหลัง) */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, marginBottom:16, flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button onClick={() => setMode('admin')} style={tabStyle('admin')}>🗂 Admin จัดการข้อมูล</button>
          <button onClick={() => setMode('master')} style={tabStyle('master')}>🎛 Master Control</button>
          <button onClick={() => setMode('questions')} style={tabStyle('questions')}>📋 คลังโจทย์</button>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button onClick={() => setMode('bls')} style={tabStyle('bls')}>🫀 BLS ผลการแข่งขัน</button>
          <button onClick={() => setMode('megacode')} style={tabStyle('megacode')}>🏆 Mega Code</button>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button onClick={() => setMode('audit')} style={tabStyle('audit')}>🔍 ตรวจสอบย้อนหลัง</button>
        </div>
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

          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:12 }}>
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

          <div className="card" style={{ marginBottom:20 }}>
            <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:11, color:'var(--muted)', marginBottom:10 }}>
              🔄 รีเซ็ตข้อมูลการแข่งขัน
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <select value={resetTarget} onChange={e => setResetTarget(e.target.value)} style={{ flex:1 }}>
                <option value="BLS">เฉพาะฐาน BLS</option>
                <option value="ECG">เฉพาะฐาน ECG</option>
                <option value="ALGORITHM">เฉพาะฐาน Algorithm</option>
                <option value="ALL">ทุกฐาน (ทั้งงาน + กลับไปยังไม่เริ่ม)</option>
              </select>
              <button onClick={() => resetCompetition(resetTarget)} style={{
                padding:'0 20px', borderRadius:10, border:'1px solid var(--amber)',
                background:'transparent', color:'var(--amber)',
                fontFamily:'JetBrains Mono,monospace', fontWeight:700, fontSize:13, cursor:'pointer',
              }}>
                รีเซ็ต
              </button>
            </div>
            <p className="note">
              เลือกฐานเดียว = ล้างเฉพาะคิว/ผลคะแนนของฐานนั้น ไม่กระทบฐานอื่นหรือรอบกิจกรรมปัจจุบัน<br/>
              "ทุกฐาน" = ล้างทั้งหมดและกลับไปสถานะ "ยังไม่เริ่ม" ใช้เมื่อต้องแข่งขันใหม่ทั้งงานเท่านั้น
            </p>
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

          <TeamJudgeManager teams={teams} judges={judges} onReload={loadDeviceData} />

          <ParticipantManager teams={teams} />

          <div style={{ marginTop: 20 }}>
            <MegaCodeSettings teams={teams} />
          </div>
        </div>
      )}

      {/* ===== โหมด คลังโจทย์ (แยกเป็นแท็บของตัวเอง) ===== */}
      {mode === 'questions' && (
        <div>
          <h1 className="page-title">คลังโจทย์</h1>
          <p className="page-sub">เพิ่ม/แก้ไขโจทย์ ECG และ Algorithm</p>
          <QuestionManager />
        </div>
      )}

      {/* ===== โหมด AUDIT TRAIL (แยกออกมาเป็นแท็บของตัวเอง) ===== */}
      {mode === 'audit' && (
        <div>
          <h1 className="page-title">ตรวจสอบย้อนหลัง</h1>
          <p className="page-sub">ใช้เมื่อผู้เข้าแข่งขัน Defense ผลการตัดสิน — ดูประวัติการตัดสินทุกครั้งพร้อมหลักฐาน</p>
          <AuditTrail teams={teams} />
          <ForceFinishTool teams={teams} />
        </div>
      )}

      {/* ===== โหมด BLS ===== */}
      {mode === 'bls' && (
        <div>
          <h1 className="page-title">ผลการแข่งขัน BLS</h1>
          <p className="page-sub">ฐาน BLS เปลี่ยนเป็นกรอกอันดับด้วยมือ (ตัดสินจากทีมที่ทำครบ 5 คนก่อน) แทนหน้าจอกรรมการเดิม</p>
          <BLSRankingManager teams={teams} />
        </div>
      )}

      {/* ===== โหมด MEGA CODE (เฉพาะกรอกคะแนน — ตั้งค่าย้ายไปหน้า Admin แล้ว) ===== */}
      {mode === 'megacode' && (
        <div>
          <h1 className="page-title">Mega Code — กรอกคะแนน</h1>
          <p className="page-sub">กรอกคะแนนรวมจาก Checklist กระดาษ + ระบบจัดอันดับให้อัตโนมัติ (ตั้งค่าทีมเข้ารอบได้ที่หน้า Admin)</p>
          <MegaCodeScoring />
        </div>
      )}
    </div>
  )
}
