// src/screens/JudgeBLS.jsx
// ============================================================
// v3: เปลี่ยนวิธีจับเวลา — แยก "เวลาทำ CPR จริง" ออกจาก "เวลารีเซ็ตหุ่น"
//
// เดิม: นาฬิกาเดินต่อเนื่องตั้งแต่คนแรกจนคนสุดท้าย (รวมเวลารีเซ็ตหุ่นปนไปด้วย)
// ใหม่: กรรมการกด "▶️ เริ่ม" เองก่อนแต่ละคน แล้วกด "ผ่าน/ไม่ผ่าน" เพื่อหยุดนาฬิกา
//       ช่วงเวลาระหว่างที่กรรมการรีเซ็ตหุ่น (นาฬิกาหยุดนิ่ง) จะไม่ถูกนับรวม
//       เวลารวมของทีม = ผลบวกของทุกช่วงที่นาฬิกาเดิน (เวลาทำ CPR จริงล้วนๆ)
// ============================================================

import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getServerTimeMs } from '../lib/serverTime'
import { useButtonGuard } from '../lib/useButtonGuard'
import { finalizeStationResult } from '../lib/scoring'

export default function JudgeBLS() {
  const judgeId = localStorage.getItem('judgeId')
  const teamId  = localStorage.getItem('teamId')

  async function leaveTeam() {
    if (!confirm('ยืนยันรีเซ็ตฐานนี้ — ข้อมูลคิวปัจจุบันจะเริ่มใหม่')) return
    if (assignmentId) await supabase.from('judge_assignments').delete().eq('assignment_id', assignmentId)
    window.location.reload()
  }

  const [queue,        setQueue]        = useState([])
  const [teamName,     setTeamName]     = useState('')
  const [assignmentId, setAssignmentId] = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [allPassed,    setAllPassed]    = useState(false)

  // เวลาสะสม (วินาที) จากทุกช่วงที่นาฬิกาเคยเดินจบไปแล้ว
  const [accumulatedSeconds, setAccumulatedSeconds] = useState(0)
  // กำลังจับเวลาช่วงปัจจุบันอยู่หรือไม่ (กรรมการกด "เริ่ม" แล้วยังไม่กดผ่าน/ไม่ผ่าน)
  const [segmentRunning, setSegmentRunning] = useState(false)
  // เวลาที่แสดงผลบนจอ ณ ขณะนี้ (accumulated + ช่วงที่กำลังเดินอยู่ ถ้ามี)
  const [displaySeconds, setDisplaySeconds] = useState(0)

  const segmentStartMsRef = useRef(null) // เวลา server ตอนกด "เริ่ม" ล่าสุด
  const tickRef = useRef(null)

  const passGuard  = useButtonGuard()
  const failGuard  = useButtonGuard()
  const startGuard = useButtonGuard()

  // ─── โหลดข้อมูล ───
  useEffect(() => {
    async function load() {
      const { data: team } = await supabase
        .from('teams').select('team_name').eq('team_id', teamId).single()
      setTeamName(team?.team_name || '')

      const { data: members } = await supabase
        .from('participants').select('*')
        .eq('team_id', teamId).eq('is_reserve', false).order('queue_order')

      const { data: asgn } = await supabase
        .from('judge_assignments').select('assignment_id, started_at')
        .eq('judge_id', judgeId).eq('team_id', teamId).eq('status', 'active').single()

      // บันทึก started_at ครั้งแรก (ใช้อ้างอิงเวลาที่ทีมนี้เริ่มฐาน ไม่ใช่ตัวตัดสินคะแนน)
      if (asgn?.assignment_id && !asgn.started_at) {
        await supabase.from('judge_assignments')
          .update({ started_at: new Date().toISOString() })
          .eq('assignment_id', asgn.assignment_id)
      }
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

  // ─── ตัวนับเวลาที่แสดงผล (อัปเดตทุก 0.5 วิ เฉพาะตอนช่วงกำลังเดิน) ───
  useEffect(() => {
    if (segmentRunning) {
      tickRef.current = setInterval(() => {
        const elapsed = segmentStartMsRef.current ? (Date.now() - segmentStartMsRef.current) / 1000 : 0
        setDisplaySeconds(accumulatedSeconds + elapsed)
      }, 500)
    } else {
      clearInterval(tickRef.current)
      setDisplaySeconds(accumulatedSeconds)
    }
    return () => clearInterval(tickRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentRunning, accumulatedSeconds])

  function formatTime(sec) {
    const s = Math.round(sec)
    const m = Math.floor(s / 60).toString().padStart(2, '0')
    const ss = (s % 60).toString().padStart(2, '0')
    return `${m}:${ss}`
  }

  const activeIdx    = queue.findIndex(p => p.status === 'active')
  const activePerson = queue[activeIdx]

  // ─── กรรมการกด "▶️ เริ่ม" ให้คนปัจจุบัน ───
  const handleStart = useCallback(() => startGuard.run(async () => {
    const nowMs = await getServerTimeMs()
    segmentStartMsRef.current = nowMs
    setSegmentRunning(true)
  }), [startGuard])

  // ─── บันทึกผลลง Supabase + หยุดนาฬิกาช่วงนี้ ───
  async function recordAttemptAndStop(participantId, result) {
    let segmentElapsed = 0
    if (segmentRunning && segmentStartMsRef.current) {
      const nowMs = await getServerTimeMs()
      segmentElapsed = (nowMs - segmentStartMsRef.current) / 1000
    }
    const newAccumulated = accumulatedSeconds + segmentElapsed
    setAccumulatedSeconds(newAccumulated)
    setSegmentRunning(false)
    segmentStartMsRef.current = null

    await supabase.from('attempts').insert({
      participant_id: participantId,
      assignment_id: assignmentId,
      station_type: 'BLS',
      result,
      judged_by: judgeId,
      time_used_seconds: segmentElapsed,
    })
    return newAccumulated
  }

  async function finishStation(finalAccumulated) {
    setAllPassed(true)
    await supabase.from('judge_assignments')
      .update({
        status: 'finished',
        finished_at: new Date().toISOString(),
        active_duration_seconds: finalAccumulated,
      })
      .eq('assignment_id', assignmentId)
    await finalizeStationResult('BLS')
  }

  // ─── กดผ่าน ───
  const handlePass = useCallback(() => passGuard.run(async () => {
    if (activeIdx < 0) return
    const newAccumulated = await recordAttemptAndStop(activePerson.participant_id, 'pass')

    const next = queue.map((p, i) => i === activeIdx ? { ...p, status: 'passed' } : p)
    const nextWaiting = next.findIndex(p => p.status === 'waiting' || p.status === 'resting')
    if (nextWaiting >= 0) next[nextWaiting] = { ...next[nextWaiting], status: 'active' }
    setQueue(next)

    if (next.every(p => p.status === 'passed')) await finishStation(newAccumulated)
  }), [queue, activeIdx, activePerson, passGuard, accumulatedSeconds, segmentRunning])

  // ─── กดไม่ผ่าน → พักคิว ───
  const handleFail = useCallback(() => failGuard.run(async () => {
    if (activeIdx < 0) return
    await recordAttemptAndStop(activePerson.participant_id, 'fail')

    const next = [...queue]
    const rested = { ...next[activeIdx], status: 'resting', retryCount: next[activeIdx].retryCount + 1 }
    next.splice(activeIdx, 1)
    next.push(rested)
    const nextIdx = next.findIndex(p => p.status === 'waiting' || p.status === 'resting')
    if (nextIdx >= 0) next[nextIdx] = { ...next[nextIdx], status: 'active' }
    setQueue(next)
  }), [queue, activeIdx, activePerson, failGuard, accumulatedSeconds, segmentRunning])

  async function handleCorrect(participantId, newResult) {
    await supabase.from('attempts').insert({
      participant_id: participantId, assignment_id: assignmentId,
      station_type: 'BLS', result: newResult, judged_by: judgeId, time_used_seconds: 0,
    })
    setQueue(prev => prev.map(p => {
      if (p.participant_id !== participantId) return p
      return { ...p, status: newResult === 'pass' ? 'passed' : 'resting',
               retryCount: newResult === 'pass' ? p.retryCount : p.retryCount + 1 }
    }))
  }

  const statusBadge = {
    active:  <span className="badge badge-pass">กำลังสอบ</span>,
    passed:  <span className="badge badge-pass">✓ ผ่าน</span>,
    resting: <span className="badge badge-resting">พักคิว 🔁</span>,
    waiting: <span className="badge badge-wait">รอ</span>,
  }

  if (loading) return <div className="screen"><p style={{color:'var(--muted)',marginTop:24,fontFamily:'JetBrains Mono,monospace'}}>กำลังโหลด...</p></div>

  return (
    <div className="screen">
      {/* หัว */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginTop:20, marginBottom:18 }}>
        <div>
          <div style={{ fontSize:22, fontWeight:800 }}>{teamName}</div>
          <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:12, color:'var(--muted)' }}>ฐาน BLS</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:28, fontWeight:700,
                        color: allPassed ? 'var(--ecg)' : segmentRunning ? 'var(--ecg)' : 'var(--text)' }}>
            ⏱ {formatTime(displaySeconds)}
          </div>
          <button onClick={leaveTeam} style={{
            fontFamily:'JetBrains Mono,monospace', fontSize:11, background:'none',
            border:'1px solid var(--line)', color:'var(--muted)', borderRadius:6,
            padding:'6px 10px', cursor:'pointer',
          }}>🔄 รีเซ็ตฐานนี้</button>
        </div>
      </div>

      <p className="page-sub" style={{marginTop:-10}}>
        {segmentRunning
          ? <span style={{color:'var(--ecg)'}}>🟢 กำลังจับเวลา — กด "ผ่าน/ไม่ผ่าน" เมื่อสอบเสร็จ</span>
          : <span style={{color:'var(--muted)'}}>⏸️ นาฬิกาหยุดนิ่ง — กด "เริ่ม" เมื่อพร้อมให้คนถัดไปสอบ</span>}
      </p>

      {/* การ์ดควบคุมคนที่ active */}
      {activePerson && !allPassed && (
        <div className="card" style={{ borderColor:'var(--ecg-dim)', marginBottom:16 }}>
          <div className="p-name" style={{ marginBottom:6 }}>{activePerson.full_name}</div>
          <div className="p-sub" style={{ marginBottom:14 }}>
            {segmentRunning ? 'กำลังทำการทดสอบ' : 'รอกรรมการกดเริ่ม'} · สอบซ้ำ {activePerson.retryCount} ครั้ง
          </div>

          {!segmentRunning ? (
            <button
              onClick={handleStart}
              disabled={startGuard.busy}
              style={{
                width:'100%', padding:18, borderRadius:12, border:'none',
                background:'var(--ecg)', color:'#04170D', fontFamily:'Sarabun,sans-serif',
                fontWeight:800, fontSize:20, cursor:'pointer', opacity: startGuard.busy ? .6 : 1,
              }}
            >
              {startGuard.busy ? 'กำลังเริ่ม...' : '▶️ เริ่ม'}
            </button>
          ) : (
            <div className="btn-judge-row">
              <button className="btn-pass" onClick={handlePass} disabled={passGuard.busy || failGuard.busy}
                style={{ opacity:(passGuard.busy||failGuard.busy) ? .6 : 1 }}>
                {passGuard.busy ? 'บันทึก...' : '✓ ผ่าน'}
              </button>
              <button className="btn-fail" onClick={handleFail} disabled={passGuard.busy || failGuard.busy}
                style={{ opacity:(passGuard.busy||failGuard.busy) ? .6 : 1 }}>
                {failGuard.busy ? 'บันทึก...' : '✕ ไม่ผ่าน'}
              </button>
            </div>
          )}
        </div>
      )}

      {allPassed && (
        <div className="card" style={{ borderColor:'var(--ecg)', textAlign:'center', padding:28 }}>
          <div style={{ fontSize:48, marginBottom:8 }}>🎉</div>
          <div style={{ fontSize:24, fontWeight:800, color:'var(--ecg)' }}>ผ่านครบทุกคน!</div>
          <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:14, color:'var(--muted)', marginTop:8 }}>
            เวลาทำ CPR จริงรวมทีม: {formatTime(displaySeconds)}
          </div>
        </div>
      )}

      {/* รายชื่อทั้งหมด */}
      <div style={{ marginTop:8 }}>
        {queue.map(p => (
          <div key={p.participant_id} className={`participant-row ${p.status}`}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div className="p-name">{p.full_name}</div>
                <div className="p-sub">
                  {p.status === 'resting' ? `สอบซ้ำ ${p.retryCount} ครั้ง` :
                   p.status === 'passed'  ? 'ผ่านแล้ว' :
                   p.status === 'active'  ? (segmentRunning ? 'กำลังทำการทดสอบ' : 'รอกดเริ่ม') : 'รอคิว'}
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
                {statusBadge[p.status]}
                {(p.status === 'passed' || p.status === 'resting') && (
                  <EditResult onCorrect={(newResult) => handleCorrect(p.participant_id, newResult)} />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="note">
        ✅ นาฬิกาจับเฉพาะเวลาที่ทำ CPR จริง — ช่วงรีเซ็ตหุ่นระหว่างคน ไม่ถูกนับรวม<br/>
        ✅ กด "เริ่ม" เองทุกครั้งก่อนคนถัดไปสอบ เมื่อหุ่นพร้อมแล้วเท่านั้น<br/>
        ✅ ทุกคนที่ตัดสินไปแล้ว มีปุ่ม "แก้ไขผล" กำกับ กดได้ทุกเมื่อ
      </p>
    </div>
  )
}

function EditResult({ onCorrect }) {
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
            style={{flex:'none',padding:'8px 14px',fontSize:13, opacity:guard.busy?.6:1}}
            disabled={guard.busy}
            onClick={() => guard.run(async () => { await onCorrect('pass'); setOpen(false) })}>
            {guard.busy ? '...' : '✓ ผ่าน'}
          </button>
          <button className="btn-fail"
            style={{flex:'none',padding:'8px 14px',fontSize:13, opacity:guard.busy?.6:1}}
            disabled={guard.busy}
            onClick={() => guard.run(async () => { await onCorrect('fail'); setOpen(false) })}>
            {guard.busy ? '...' : '✕ ไม่ผ่าน'}
          </button>
        </div>
      )}
    </div>
  )
}
