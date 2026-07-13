// src/screens/MasterPanel.jsx
import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentEvent } from '../lib/currentEvent'
import { FIXED_POINTS } from '../lib/scoring'
import EventManager from '../components/EventManager'
import AuditTrail from '../components/AuditTrail'
import TeamJudgeManager from '../components/TeamJudgeManager'
import MegaCodeSettings from '../components/MegaCodeSettings'
import MegaCodeScoring from '../components/MegaCodeScoring'
import BLSRankingManager from '../components/BLSRankingManager'
import ForceFinishTool from '../components/ForceFinishTool'
import Credits from '../components/Credits'
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
  const [currentEvent,  setCurrentEvent]  = useState(null) // งานแข่งขันที่กำลังเปิดอยู่

  // สำหรับจับคู่ "เครื่อง" กับ "ทีม + กรรมการ" ล่วงหน้า
  const [teams,     setTeams]     = useState([])
  const [judges,    setJudges]    = useState([])
  const [devices,   setDevices]   = useState([]) // [{device_number, team_id, judge_id}]
  const currentEventRef = useRef(null) // เก็บ currentEvent ล่าสุดไว้ใช้ใน realtime callback กัน stale closure
  useEffect(() => { currentEventRef.current = currentEvent }, [currentEvent])

  async function loadDeviceData(eventId) {
    const evId = eventId || currentEvent?.event_id
    if (!evId) return
    const { data: teamList }  = await supabase.from('teams').select('*').eq('event_id', evId).order('team_name')
    const { data: judgeList } = await supabase.from('judges').select('*').eq('event_id', evId).order('full_name')
    const { data: devList }   = await supabase.from('device_assignments').select('*').eq('event_id', evId).order('device_number')
    setTeams(teamList || [])
    setJudges(judgeList || [])
    setDevices(devList || [])
  }

  async function saveDeviceRow(deviceNumber, field, value) {
    const existing = devices.find(d => d.device_number === deviceNumber)

    // กันเลือกซ้ำ — ทีมเดียว/กรรมการคนเดียว ต้องจับคู่ได้แค่ 1 เครื่องเท่านั้นในงานนี้
    if (value) {
      const dup = devices.find(d => d.device_number !== deviceNumber && d[field] === value)
      if (dup) {
        const label = field === 'team_id' ? 'ทีมนี้' : 'กรรมการคนนี้'
        alert(`${label} ถูกจับคู่กับเครื่อง #${dup.device_number} ไปแล้ว — เลือกซ้ำไม่ได้ กรุณาเลือกทีม/กรรมการอื่น หรือไปแก้เครื่อง #${dup.device_number} ก่อน`)
        return
      }
    }

    const row = {
      device_number: deviceNumber, event_id: currentEvent?.event_id,
      team_id: existing?.team_id || null, judge_id: existing?.judge_id || null, [field]: value,
    }
    const { error } = await supabase.from('device_assignments').upsert(row, { onConflict: 'device_number,event_id' })
    if (error) alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    loadDeviceData()
  }

  async function loadAll(eventId) {
    // ใช้ ref แทน currentEvent state ตรงๆ — ฟังก์ชันนี้ถูกเรียกจาก realtime subscription
    // ที่ตั้งค่าไว้ครั้งเดียวตอน mount (ดูใน useEffect ด้านล่าง) ถ้าอ้าง currentEvent ตรงๆ
    // จะได้ค่า null ค้างตลอดไป (stale closure) ทำให้ evId เป็น undefined แล้วฟังก์ชัน return ทิ้ง
    // เงียบๆ ทุกครั้งที่ realtime สั่งให้โหลดใหม่ — เป็นสาเหตุที่ตาราง "รอบปัจจุบัน" ไม่เคย
    // อัปเดตรายชื่อกรรมการที่ล็อกอินเข้ามาเลย
    const evId = eventId || currentEventRef.current?.event_id
    if (!evId) return
    let { data } = await supabase.from('event_state').select('*').eq('event_id', evId).maybeSingle()

    // ระบบซ่อมตัวเอง — ถ้างานนี้ไม่มีแถว event_state เลย (เช่นเกิดบั๊กตอนสร้างงาน) ให้สร้างให้อัตโนมัติ
    // กันปัญหา "กดปุ่มแล้วเงียบ ไม่มีอะไรเกิดขึ้น" เพราะหาแถวให้อัปเดตไม่เจอ
    if (!data) {
      const { data: created } = await supabase.from('event_state').insert({
        event_id: evId, active_station: 'IDLE', registration_open: true,
        total_teams_registered: 5, megacode_mode: 'separate', bls_mode: 'manual',
      }).select().maybeSingle()
      data = created
    }

    if (data) {
      setActiveStation(data.active_station)
      setTotalTeams(data.total_teams_registered)
      setRegOpen(data.registration_open)
    }

    // ดึงทีมของงานนี้ "สดใหม่" ทุกครั้งแทนที่จะใช้ teams state — เหตุผลเดียวกับข้างบน
    // (state teams ก็เป็น stale closure ในบริบทนี้เช่นกัน ถ้าอ้างตรงๆ จะเป็นค่าว่างค้างตลอดไป
    // ทำให้กรองรายชื่อกรรมการออกหมดทุกคน ทั้งที่ล็อกอินเข้ามาจริง)
    const { data: teamRows } = await supabase.from('teams').select('team_id').eq('event_id', evId)
    const currentTeamIds = new Set((teamRows || []).map(t => t.team_id))

    const { data: asgn } = await supabase
      .from('judge_assignments')
      .select('*, teams(team_name), judges(full_name)')
      .eq('status', 'active')
    // กรองเฉพาะรายการของทีมในงานปัจจุบัน (judge_assignments ไม่มี event_id ตรง แต่ team_id อ้างอิงงานอยู่แล้ว)
    setAssignments((asgn || []).filter(a => currentTeamIds.has(a.team_id)))
  }

  useEffect(() => {
    async function init() {
      const ev = await getCurrentEvent()
      setCurrentEvent(ev)
      if (ev) { loadAll(ev.event_id); loadDeviceData(ev.event_id) }
    }
    init()
    const sub = supabase.channel('event-state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_state' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'judge_assignments' }, () => loadAll())
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
    const { error } = await supabase.from('event_state').update({ active_station: station }).eq('event_id', currentEvent?.event_id)
    if (error) {
      alert(`เปลี่ยนฐานไม่สำเร็จ: ${error.message}\n\nกรุณาแจ้งผู้ดูแลระบบ (อาจเป็นปัญหาสิทธิ์การเขียนฐานข้อมูล)`)
      setSaving(false)
      return
    }
    setActiveStation(station) // อัปเดตหน้าจอเฉพาะเมื่อบันทึกลงฐานข้อมูลสำเร็จจริงเท่านั้น
    setSaving(false)
  }

  async function saveTeamCount(n) {
    const { error } = await supabase.from('event_state').update({ total_teams_registered: n }).eq('event_id', currentEvent?.event_id)
    if (error) {
      alert(`บันทึกจำนวนทีมไม่สำเร็จ: ${error.message}`)
      return
    }
    setTotalTeams(n)
  }

  // เปิด/ปิดการแข่งขัน — ถ้าปิด กรรมการและผู้แข่งขันทุกคนจะเข้าหน้าจอไม่ได้ทันที
  async function toggleRegistration() {
    const next = !regOpen
    const { error } = await supabase.from('event_state').update({ registration_open: next }).eq('event_id', currentEvent?.event_id)
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
    const isAll  = stationFilter === 'ALL'
    const isFull = stationFilter === 'FULL'
    const isMegacodeOnly = stationFilter === 'MEGACODE_ONLY'
    const label = isAll ? 'ทุกฐาน (ทั้งงาน)' : stationFilter
    const currentTeamIds = teams.map(t => t.team_id) // สำคัญมาก: จำกัดขอบเขตแค่ทีมของงานปัจจุบันเท่านั้น

    if (isMegacodeOnly) {
      if (!confirm(`ยืนยันรีเซ็ตเฉพาะ Mega Code (เฉพาะงาน "${currentEvent?.event_name}")?\n\nจะล้าง: ทีมที่คัดเข้ารอบ + คะแนน Mega Code ทั้งหมด\nจะไม่ลบ: ฐาน BLS/ECG/Algorithm, ทีม/กรรมการ/ผู้เข้าแข่งขัน`)) return
      const { error: em1 } = await supabase.from('megacode_results').delete().in('team_id', currentTeamIds)
      const { error: em2 } = await supabase.from('megacode_qualifiers').delete().in('team_id', currentTeamIds)
      const err = em1 || em2
      if (err) alert(`รีเซ็ต Mega Code ไม่สำเร็จ: ${err.message}`)
      else alert('รีเซ็ต Mega Code เรียบร้อยแล้ว')
      loadAll()
      return
    }

    if (currentTeamIds.length === 0 && !isFull) { alert('ยังไม่มีทีมในงานนี้ ไม่มีอะไรให้รีเซ็ต'); return }

    if (isFull) {
      const confirmText = prompt(
        `⚠️ คำเตือนสำคัญ: จะลบทีม/กรรมการ/ผู้เข้าแข่งขัน/การจับคู่เครื่อง/ผลคะแนนทั้งหมด ` +
        `ของงาน "${currentEvent?.event_name}" ทิ้งทั้งหมด (คลังโจทย์ไม่ถูกลบ)\n\n` +
        `การกระทำนี้ย้อนกลับไม่ได้ — พิมพ์คำว่า RESET เพื่อยืนยัน`
      )
      if (confirmText !== 'RESET') { if (confirmText !== null) alert('ยกเลิก — พิมพ์ไม่ตรง'); return }
    } else if (!confirm(
      `ยืนยันรีเซ็ต${isAll ? 'การแข่งขันทั้งหมด' : `เฉพาะฐาน "${stationFilter}"`} (เฉพาะงาน "${currentEvent?.event_name}")?\n\n` +
      `จะล้าง: คิวปัจจุบัน, ผลคะแนน, การจับคู่กรรมการ-ทีมของ${label}\n` +
      `จะไม่ลบ: ชื่อทีม/กรรมการ/ผู้เข้าแข่งขัน, คลังโจทย์, การจับคู่เครื่อง, งานแข่งขันอื่น\n\n` +
      (isAll ? 'จะรีเซ็ตสถานะกลับเป็น "ยังไม่เริ่ม" ด้วย' : 'ฐานอื่นและรอบกิจกรรมปัจจุบันจะไม่ถูกแตะต้อง')
    )) return

    let e1, e2, e3, e4

    // หาผู้เข้าแข่งขันทั้งหมดของทีมในงานนี้ก่อน (ใช้กรอง attempts)
    const { data: partRows } = await supabase.from('participants').select('participant_id').in('team_id', currentTeamIds)
    const participantIds = (partRows || []).map(p => p.participant_id)

    if (isFull) {
      // รีเซ็ตทั้งกระดาน — ลบทีม/กรรมการ/ผู้เข้าแข่งขัน/การจับคู่เครื่องด้วย (ยกเว้นคลังโจทย์)
      if (participantIds.length > 0) {
        await supabase.from('attempts').delete().in('participant_id', participantIds)
      }
      await supabase.from('judge_assignments').delete().in('team_id', currentTeamIds)
      await supabase.from('station_results').delete().in('team_id', currentTeamIds)
      await supabase.from('megacode_results').delete().in('team_id', currentTeamIds)
      await supabase.from('megacode_qualifiers').delete().in('team_id', currentTeamIds)
      await supabase.from('device_assignments').delete().eq('event_id', currentEvent?.event_id)
      // participants ถูกลบอัตโนมัติเมื่อลบทีม (CASCADE) แต่ลบตรงๆ ไว้ด้วยกันพลาด
      await supabase.from('participants').delete().in('team_id', currentTeamIds)
      await supabase.from('teams').delete().eq('event_id', currentEvent?.event_id)
      await supabase.from('judges').delete().eq('event_id', currentEvent?.event_id)
      const { error: stateErr } = await supabase.from('event_state')
        .update({ active_station: 'IDLE', registration_open: true }).eq('event_id', currentEvent?.event_id)
      if (stateErr) { alert(`รีเซ็ตไม่สำเร็จบางส่วน: ${stateErr.message}`) }
      else { alert('รีเซ็ตทั้งกระดานเรียบร้อยแล้ว — พร้อมลงทะเบียนทีมใหม่') }
      loadAll(); loadDeviceData()
      return
    }

    if (isAll) {
      if (participantIds.length > 0) {
        ;({ error: e1 } = await supabase.from('attempts').delete().in('participant_id', participantIds))
      }
      ;({ error: e2 } = await supabase.from('judge_assignments').delete().in('team_id', currentTeamIds))
      ;({ error: e3 } = await supabase.from('station_results').delete().in('team_id', currentTeamIds))
      ;({ error: e4 } = await supabase.from('megacode_qualifiers').delete().in('team_id', currentTeamIds))
      await supabase.from('event_state').update({ active_station: 'IDLE', registration_open: true }).eq('event_id', currentEvent?.event_id)
    } else {
      // รีเซ็ตเฉพาะฐานที่เลือก — จำกัดแค่ทีมของงานปัจจุบัน ไม่แตะฐานอื่น/งานอื่น
      const { data: asgnRows } = await supabase
        .from('judge_assignments').select('assignment_id')
        .eq('station_type', stationFilter).in('team_id', currentTeamIds)
      const assignmentIds = (asgnRows || []).map(a => a.assignment_id)

      if (assignmentIds.length > 0) {
        ;({ error: e1 } = await supabase.from('attempts').delete().in('assignment_id', assignmentIds))
      }
      ;({ error: e2 } = await supabase.from('judge_assignments').delete().eq('station_type', stationFilter).in('team_id', currentTeamIds))
      ;({ error: e3 } = await supabase.from('station_results').delete().eq('station_type', stationFilter).in('team_id', currentTeamIds))
    }

    const firstError = e1 || e2 || e3 || e4
    if (firstError) {
      alert(`รีเซ็ตไม่สำเร็จบางส่วน: ${firstError.message}`)
    } else {
      alert(`รีเซ็ต${isAll ? 'การแข่งขันทั้งหมด' : `ฐาน "${stationFilter}"`}เรียบร้อยแล้ว (เฉพาะงานปัจจุบัน)`)
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
      {/* แสดงชื่องานที่กำลังเปิดอยู่เสมอ กันสับสนว่ากำลังแก้ไขงานไหน + ปุ่มเปิด Leaderboard */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, flexWrap:'wrap', gap:10 }}>
        {currentEvent ? (
          <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:12, color:'var(--ecg)' }}>
            📌 งานปัจจุบัน: {currentEvent.event_name}
          </div>
        ) : <div />}
        <button
          onClick={() => window.open(currentEvent ? `/leaderboard?event=${currentEvent.event_id}` : '/leaderboard', '_blank')}
          style={{
            padding:'8px 16px', borderRadius:16, cursor:'pointer',
            border:'1px solid var(--ecg)', background:'transparent', color:'var(--ecg)',
            fontFamily:'JetBrains Mono,monospace', fontWeight:700, fontSize:12,
          }}
        >
          📊 เปิด Leaderboard (แท็บใหม่)
        </button>
      </div>

      {/* สลับโหมด — จัด 3 กลุ่ม: ซ้าย(งานแข่งขัน/Admin/Master) กลาง(BLS/MegaCode) ขวา(ตรวจสอบย้อนหลัง) */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, marginBottom:16, flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button onClick={() => setMode('events')} style={tabStyle('events')}>🏠 งานแข่งขัน</button>
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

      {/* ===== โหมด งานแข่งขัน (หน้าแรก — สร้าง/สลับ/ดูงานเก่า) ===== */}
      {mode === 'events' && (
        <div>
          <h1 className="page-title">งานแข่งขัน</h1>
          <p className="page-sub">เปิดงานใหม่เพื่อเริ่มแข่งขันครั้งถัดไป หรือดูผลย้อนหลังงานเก่าที่ผ่านมา</p>
          <EventManager onEventChanged={async () => {
            const ev = await getCurrentEvent()
            setCurrentEvent(ev)
            if (ev) { loadAll(ev.event_id); loadDeviceData(ev.event_id) }
            setMode('admin')
          }} />
        </div>
      )}

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
                <option value="ALL">ทุกฐาน (ล้างคะแนน + กลับไปยังไม่เริ่ม)</option>
                <option value="MEGACODE_ONLY">🏆 เฉพาะ Mega Code (ล้างทีมเข้ารอบ+คะแนน)</option>
                <option value="FULL">⚠️ ทั้งกระดาน (ลบทีม/กรรมการ/ผู้เข้าแข่งขันด้วย)</option>
              </select>
              <button onClick={() => resetCompetition(resetTarget)} style={{
                padding:'0 20px', borderRadius:10,
                border:`1px solid ${resetTarget === 'FULL' ? 'var(--alert)' : 'var(--amber)'}`,
                background:'transparent', color: resetTarget === 'FULL' ? 'var(--alert)' : 'var(--amber)',
                fontFamily:'JetBrains Mono,monospace', fontWeight:700, fontSize:13, cursor:'pointer',
              }}>
                รีเซ็ต
              </button>
            </div>
            <p className="note">
              เลือกฐานเดียว = ล้างเฉพาะคิว/ผลคะแนนของฐานนั้น ไม่กระทบฐานอื่นหรือรอบกิจกรรมปัจจุบัน<br/>
              "ทุกฐาน" = ล้างคะแนนทั้งหมดและกลับไปสถานะ "ยังไม่เริ่ม" (ทีม/กรรมการยังอยู่ครบ)<br/>
              "เฉพาะ Mega Code" = ล้างเฉพาะรอบตัดเชือก ไม่กระทบ 3 ฐานแรก<br/>
              <b style={{color:'var(--alert)'}}>"ทั้งกระดาน" = ลบทีม/กรรมการ/ผู้เข้าแข่งขันจริงด้วย</b> ใช้เมื่อต้องเริ่มลงทะเบียนใหม่ทั้งหมด (คลังโจทย์ไม่ถูกลบ) — ย้อนกลับไม่ได้ ต้องพิมพ์ยืนยัน
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

          {/* ย้ายมาจากแท็บ "ตรวจสอบย้อนหลัง" — เป็นเครื่องมือแทรกแซงระหว่างแข่งสด ควรอยู่คู่กับ
              การควบคุมฐาน/รีเซ็ตด้านบนนี้ มากกว่าอยู่กับเครื่องมือตรวจสอบย้อนหลังแบบอ่านอย่างเดียว */}
          <ForceFinishTool teams={teams} eventId={currentEvent?.event_id} />
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
              แต้มคงที่ทุกฐาน ไม่ผันตามจำนวนทีม (อันดับ {Object.entries(FIXED_POINTS).map(([r,p])=>`${r}=${p}`).join(', ')} แต้ม — อันดับ {Object.keys(FIXED_POINTS).length+1} ขึ้นไปได้ 0 แต้ม) จำนวนทีมด้านบนนี้ใช้แค่กำหนดจำนวนแถวจับคู่เครื่องและเกณฑ์คัด Mega Code เท่านั้น ไม่กระทบสูตรคะแนน<br />
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
                  // ทีม/กรรมการที่ถูกจับคู่กับเครื่องอื่นไปแล้ว (ไม่รวมของแถวตัวเอง) — เอาออกจากตัวเลือก
                  const usedTeamIds  = new Set(devices.filter(d => d.device_number !== deviceNum && d.team_id).map(d => d.team_id))
                  const usedJudgeIds = new Set(devices.filter(d => d.device_number !== deviceNum && d.judge_id).map(d => d.judge_id))
                  return (
                    <tr key={deviceNum}>
                      <td style={{ padding:'10px', borderBottom:'1px solid var(--line)', fontFamily:'JetBrains Mono,monospace', fontWeight:700 }}>#{deviceNum}</td>
                      <td style={{ padding:'10px', borderBottom:'1px solid var(--line)' }}>
                        <select value={row.team_id || ''} onChange={e => saveDeviceRow(deviceNum, 'team_id', e.target.value)}>
                          <option value="">— เลือกทีม —</option>
                          {teams.filter(t => !usedTeamIds.has(t.team_id)).map(t => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
                        </select>
                      </td>
                      <td style={{ padding:'10px', borderBottom:'1px solid var(--line)' }}>
                        <select value={row.judge_id || ''} onChange={e => saveDeviceRow(deviceNum, 'judge_id', e.target.value)}>
                          <option value="">— เลือกกรรมการ —</option>
                          {judges.filter(j => !usedJudgeIds.has(j.judge_id)).map(j => <option key={j.judge_id} value={j.judge_id}>{j.full_name}</option>)}
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

          <TeamJudgeManager teams={teams} judges={judges} onReload={loadDeviceData} eventId={currentEvent?.event_id} />

          <ParticipantManager teams={teams} eventId={currentEvent?.event_id} />

          <div style={{ marginTop: 20 }}>
            <MegaCodeSettings teams={teams} eventId={currentEvent?.event_id} />
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
          <AuditTrail teams={teams} eventId={currentEvent?.event_id} />
        </div>
      )}

      {/* ===== โหมด BLS ===== */}
      {mode === 'bls' && (
        <div>
          <h1 className="page-title">ผลการแข่งขัน BLS</h1>
          <p className="page-sub">ฐาน BLS เปลี่ยนเป็นกรอกอันดับด้วยมือ (ตัดสินจากทีมที่ทำครบ 5 คนก่อน) แทนหน้าจอกรรมการเดิม</p>
          <BLSRankingManager teams={teams} eventId={currentEvent?.event_id} />
        </div>
      )}

      {/* ===== โหมด MEGA CODE (เฉพาะกรอกคะแนน — ตั้งค่าย้ายไปหน้า Admin แล้ว) ===== */}
      {mode === 'megacode' && (
        <div>
          <h1 className="page-title">Mega Code — กรอกคะแนน</h1>
          <p className="page-sub">กรอกคะแนนรวมจาก Checklist กระดาษ + ระบบจัดอันดับให้อัตโนมัติ (ตั้งค่าทีมเข้ารอบได้ที่หน้า Admin)</p>
          <MegaCodeScoring eventId={currentEvent?.event_id} />
        </div>
      )}

      <Credits />
    </div>
  )
}
