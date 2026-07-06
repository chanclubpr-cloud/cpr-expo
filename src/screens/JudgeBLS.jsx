// src/screens/JudgeBLS.jsx
// แก้ไข v2: เพิ่ม (1) server timestamp (2) button guard กันกดซ้ำ

import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getElapsedSeconds } from '../lib/serverTime'
import { useButtonGuard } from '../lib/useButtonGuard'

export default function JudgeBLS() {
  const judgeId = localStorage.getItem('judgeId')
  const teamId  = localStorage.getItem('teamId')

  const [queue,        setQueue]        = useState([])
  const [teamName,     setTeamName]     = useState('')
  const [displayTime,  setDisplayTime]  = useState(0)   // แสดงผลบนหน้าจอ (วินาที)
  const [startedAt,    setStartedAt]    = useState(null) // ISO timestamp จาก server
  const [assignmentId, setAssignmentId] = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [allPassed,    setAllPassed]    = useState(false)

  // Button guards — แยกกัน 1 ชุดต่อ action ป้องกันกดซ้ำ
  const passGuard = useButtonGuard()
  const failGuard = useButtonGuard()

  // ตัวนับเวลาแสดงผล (เฉพาะ UI — ตัวเลขจริงดึงจาก server ตอนบันทึก)
  const displayRef = useRef(null)

  // ─── โหลดข้อมูล ───
  useEffect(() => {
    async function load() {
      const { data: team } = await supabase
        .from('teams').select('team_name').eq('team_id', teamId).single()
      setTeamName(team?.team_name || '')

      const { data: members } = await supabase
        .from('participants').select('*')
        .eq('team_id', teamId).eq('is_reserve', false).order('queue_order')

      // ดึง assignment เพื่อรู้ started_at จาก server
      const { data: asgn } = await supabase
        .from('judge_assignments').select('assignment_id, started_at')
        .eq('judge_id', judgeId).eq('team_id', teamId).eq('status', 'active').single()

      let startIso = asgn?.started_at
      // ถ้ายังไม่มี started_at ให้ตั้งค่าตอนนี้โดยดึงจาก server
      if (!startIso && asgn?.assignment_id) {
        const { data: updated } = await supabase
          .from('judge_assignments')
          .update({ started_at: new Date().toISOString() })
          .eq('assignment_id', asgn.assignment_id)
          .select('started_at').single()
        startIso = updated?.started_at
      }

      setStartedAt(startIso)
      setAssignmentId(asgn?.assignment_id)

      if (members) {
        setQueue(members.map((m, i) => ({
          ...m, status: i === 0 ? 'active' : 'waiting', retryCount: 0,
        })))
      }
      setLoading(false)
    }
    load()
  }, [judgeId, teamId])

  // ─── นาฬิกาแสดงผล (เฉพาะ UI เท่านั้น ไม่ใช้ตัดสินผล) ───
  useEffect(() => {
    if (!startedAt || allPassed) return
    displayRef.current = setInterval(() => {
      // คำนวณจาก startedAt ของ server เทียบกับ Date.now() เพื่อแสดงผล
      // ยอมรับความต่าง ~1-2 วิที่อาจเกิดจากนาฬิกาเครื่องเล็กน้อย
      const diff = Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)
      setDisplayTime(diff)
    }, 500)
    return () => clearInterval(displayRef.current)
  }, [startedAt, allPassed])

  function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2,'0')
    const s = (sec % 60).toString().padStart(2,'0')
    return `${m}:${s}`
  }

  // ─── บันทึกผลลง Supabase (เวลาจาก server) ───
  async function recordAttempt(participantId, result) {
    // ดึงเวลาที่ผ่านไปจริงจาก server ณ ขณะกดปุ่ม
    const timeUsed = startedAt ? await getElapsedSeconds(startedAt) : 0
    await supabase.from('attempts').insert({
      participant_id:    participantId,
      assignment_id:     assignmentId,
      station_type:      'BLS',
      result,
      judged_by:         judgeId,
      time_used_seconds: timeUsed,
    })
  }

  async function finishStation() {
    clearInterval(displayRef.current)
    setAllPassed(true)
    // บันทึก finished_at โดยใช้ DEFAULT now() ของ Supabase (server time)
    await supabase.from('judge_assignments')
      .update({ status: 'finished', finished_at: new Date().toISOString() })
      .eq('assignment_id', assignmentId)
  }

  // ─── กดผ่าน ───
  const handlePass = useCallback(() => passGuard.run(async () => {
    const activeIdx = queue.findIndex(p => p.status === 'active')
    if (activeIdx < 0) return
    const activePerson = queue[activeIdx]
    await recordAttempt(activePerson.participant_id, 'pass')

    const next = queue.map((p, i) => i === activeIdx ? { ...p, status: 'passed' } : p)
    const nextWaiting = next.findIndex(p => p.status === 'waiting' || p.status === 'resting')
    if (nextWaiting >= 0) next[nextWaiting] = { ...next[nextWaiting], status: 'active' }
    setQueue(next)

    if (next.every(p => p.status === 'passed')) await finishStation()
  }), [queue, passGuard])

  // ─── กดไม่ผ่าน → พักคิว ───
  const handleFail = useCallback(() => failGuard.run(async () => {
    const activeIdx = queue.findIndex(p => p.status === 'active')
    if (activeIdx < 0) return
    const activePerson = queue[activeIdx]
    await recordAttempt(activePerson.participant_id, 'fail')

    const next = [...queue]
    const rested = { ...next[activeIdx], status: 'resting', retryCount: next[activeIdx].retryCount + 1 }
    next.splice(activeIdx, 1)
    next.push(rested)
    const nextIdx = next.findIndex(p => p.status === 'waiting' || p.status === 'resting')
    if (nextIdx >= 0) next[nextIdx] = { ...next[nextIdx], status: 'active' }
    setQueue(next)
  }), [queue, failGuard])

  async function handleCorrect(participantId, newResult) {
    await recordAttempt(participantId, newResult)
    setQueue(prev => prev.map(p => {
      if (p.participant_id !== participantId) return p
      return { ...p, status: newResult === 'pass' ? 'passed' : 'resting',
               retryCount: newResult === 'pass' ? p.retryCount : p.retryCount + 1 }
    }))
  }

  const activeIdx    = queue.findIndex(p => p.status === 'active')
  const activePerson = queue[activeIdx]

  const statusBadge = {
    active:  <span className="badge badge-pass">กำลังสอบ</span>,
    passed:  <span className="badge badge-pass">✓ ผ่าน</span>,
    resting: <span className="badge badge-resting">พักคิว 🔁</span>,
    waiting: <span className="badge badge-wait">รอ</span>,
  }

  if (loading) return (
    <div className="screen">
      <p style={{color:'var(--muted)',marginTop:24,fontFamily:'JetBrains Mono,monospace'}}>
        กำลังโหลด...
      </p>
    </div>
  )

  return (
    <div className="screen">
      {/* หัว */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginTop:20,marginBottom:18}}>
        <div>
          <div style={{fontSize:22,fontWeight:800}}>{teamName}</div>
          <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:12,color:'var(--muted)'}}>
            ฐาน BLS
          </div>
        </div>
        <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:28,fontWeight:700,
                     color: allPassed ? 'var(--ecg)' : 'var(--text)'}}>
          ⏱ {formatTime(displayTime)}
        </div>
      </div>

      {/* ปุ่มตัดสิน */}
      {activePerson && !allPassed && (
        <div className="card" style={{borderColor:'var(--ecg-dim)',marginBottom:16}}>
          <div className="p-name" style={{marginBottom:4}}>{activePerson.full_name}</div>
          <div className="p-sub" style={{marginBottom:14}}>
            กำลังสอบ · สอบซ้ำ {activePerson.retryCount} ครั้ง
          </div>

          {/* แสดง error ถ้ากดแล้วมีปัญหา */}
          {(passGuard.lastError || failGuard.lastError) && (
            <div style={{background:'rgba(255,77,94,.1)',border:'1px solid var(--alert)',
                         borderRadius:8,padding:'10px 14px',marginBottom:12,
                         color:'var(--alert)',fontSize:13,fontFamily:'JetBrains Mono,monospace'}}>
              ⚠ {passGuard.lastError || failGuard.lastError} — กรุณาลองกดอีกครั้ง
            </div>
          )}

          <div className="btn-judge-row">
            {/* ปุ่มผ่าน — ปิดระหว่างบันทึก กันกดซ้ำ */}
            <button
              className="btn-pass"
              onClick={handlePass}
              disabled={passGuard.busy || failGuard.busy}
              style={{opacity: (passGuard.busy || failGuard.busy) ? .6 : 1}}
            >
              {passGuard.busy ? 'บันทึก...' : '✓ ผ่าน'}
            </button>

            {/* ปุ่มไม่ผ่าน — ปิดระหว่างบันทึก กันกดซ้ำ */}
            <button
              className="btn-fail"
              onClick={handleFail}
              disabled={passGuard.busy || failGuard.busy}
              style={{opacity: (passGuard.busy || failGuard.busy) ? .6 : 1}}
            >
              {failGuard.busy ? 'บันทึก...' : '✕ ไม่ผ่าน'}
            </button>
          </div>
        </div>
      )}

      {/* สำเร็จ */}
      {allPassed && (
        <div className="card" style={{borderColor:'var(--ecg)',textAlign:'center',padding:28}}>
          <div style={{fontSize:48,marginBottom:8}}>🎉</div>
          <div style={{fontSize:24,fontWeight:800,color:'var(--ecg)'}}>ผ่านครบทุกคน!</div>
          <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:14,
                       color:'var(--muted)',marginTop:8}}>
            เวลารวมทีม: {formatTime(displayTime)}
          </div>
        </div>
      )}

      {/* รายชื่อทั้งหมด */}
      {queue.map(p => (
        <div key={p.participant_id} className={`participant-row ${p.status}`}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <div className="p-name">{p.full_name}</div>
              <div className="p-sub">
                {p.status === 'resting' ? `สอบซ้ำ ${p.retryCount} ครั้ง` :
                 p.status === 'passed'  ? 'ผ่านแล้ว' :
                 p.status === 'active'  ? 'กำลังทำการทดสอบ' : 'รอคิว'}
              </div>
            </div>
            <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6}}>
              {statusBadge[p.status]}
              {(p.status === 'passed' || p.status === 'resting') && (
                <EditResult
                  currentStatus={p.status}
                  onCorrect={(r) => handleCorrect(p.participant_id, r)}
                />
              )}
            </div>
          </div>
        </div>
      ))}

      <p className="note">
        ✅ ทุกการกดปุ่มจะขึ้น "บันทึก..." ระหว่างส่งข้อมูล — ถ้ายังขึ้นอยู่ไม่ต้องกดซ้ำ<br/>
        ✅ เวลาที่แสดงอ้างอิงจาก server กลาง ทุกเครื่องใช้ฐานเดียวกัน
      </p>
    </div>
  )
}

function EditResult({ currentStatus, onCorrect }) {
  const [open, setOpen] = useState(false)
  const guard = useButtonGuard()
  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        style={{fontFamily:'JetBrains Mono,monospace',fontSize:11,
                background:'none',border:'1px solid var(--line)',color:'var(--muted)',
                borderRadius:5,padding:'4px 8px',cursor:'pointer'}}>
        แก้ไขผล
      </button>
      {open && (
        <div style={{display:'flex',gap:8,marginTop:6}}>
          <button className="btn-pass"
            style={{flex:'none',padding:'8px 14px',fontSize:13,
                    opacity:guard.busy?.6:1}}
            disabled={guard.busy}
            onClick={() => guard.run(async () => { await onCorrect('pass'); setOpen(false) })}>
            {guard.busy ? '...' : '✓ ผ่าน'}
          </button>
          <button className="btn-fail"
            style={{flex:'none',padding:'8px 14px',fontSize:13,
                    opacity:guard.busy?.6:1}}
            disabled={guard.busy}
            onClick={() => guard.run(async () => { await onCorrect('fail'); setOpen(false) })}>
            {guard.busy ? '...' : '✕ ไม่ผ่าน'}
          </button>
        </div>
      )}
    </div>
  )
}
