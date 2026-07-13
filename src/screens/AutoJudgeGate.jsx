// src/screens/AutoJudgeGate.jsx
// ============================================================
// แทนที่หน้า Login เดิมทั้งหมด — กรรมการไม่ต้องเลือกชื่อ/ทีมเองอีกต่อไป
//
// v2 (ระบบหลายงานแข่งขัน): ต้องรู้ "งานที่กำลังเปิดอยู่" ก่อนเสมอ
// เพราะเลขเครื่อง #1, #2, #3 ถูกใช้ซ้ำได้ในแต่ละงาน (คนละความหมายกันคนละงาน)
//
// หลักการ:
//   1) หา "งานที่กำลังเปิดอยู่" (currentEvent) ก่อน
//   2) อ่านเลขเครื่องจาก URL แล้วถามฐานข้อมูลเฉพาะของ "งานนี้" ว่าเป็นทีมไหน
//   3) ฟัง Master ว่าตอนนี้แข่งฐานอะไร (เฉพาะของงานนี้)
//   4) สลับไปแสดงหน้าจอ BLS/ECG/Algorithm ของทีมนั้นให้อัตโนมัติ
//   5) สร้าง judge_assignment ให้เองถ้ายังไม่มี (ไม่ต้องกดเลือกทีม)
// ============================================================

import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCurrentEvent } from '../lib/currentEvent'
import JudgeBLS  from './JudgeBLS'
import JudgeECG  from './JudgeECG'
import JudgeAlgo from './JudgeAlgo'

export default function AutoJudgeGate() {
  const [searchParams] = useSearchParams()
  const deviceNumber = Number(searchParams.get('device'))

  const [eventId,       setEventId]       = useState(null)
  const [blsMode,       setBlsMode]       = useState('manual')
  const [mapping,       setMapping]       = useState(null) // {team_id, judge_id, team_name, judge_name}
  const [activeStation, setActiveStation] = useState('IDLE')
  const [loading,       setLoading]       = useState(true)
  const [assignmentReady, setAssignmentReady] = useState(false)
  const [error,         setError]         = useState('')
  const eventIdRef = useRef(null) // เก็บ eventId ล่าสุดไว้ใช้ใน realtime callback กัน stale closure
  // (ถ้าใช้ eventId state ตรงๆ ใน callback ด้านล่าง จะได้ค่า null ค้างตลอดไป เพราะ useEffect
  //  ที่สร้าง subscription รันแค่ตอน deviceNumber เปลี่ยน ไม่ใช่ตอน eventId เปลี่ยน)

  // โหลดงานปัจจุบัน → การจับคู่เครื่อง → สถานะรอบกิจกรรม แล้วฟังการเปลี่ยนแปลงตลอด
  useEffect(() => {
    async function load() {
      setAssignmentReady(false)
      setError('')
      if (!deviceNumber) {
        setError('ไม่พบเลขเครื่องใน URL — ต้องเปิดแบบ /judge?device=หมายเลข')
        setLoading(false)
        return
      }

      const ev = await getCurrentEvent()
      if (!ev) {
        setError('ยังไม่มีงานแข่งขันที่เปิดอยู่ในระบบ — กรุณาแจ้ง Admin ให้เปิดงานก่อน')
        setLoading(false)
        return
      }
      setEventId(ev.event_id)
      eventIdRef.current = ev.event_id

      const { data: dev } = await supabase
        .from('device_assignments')
        .select('*, teams(team_name), judges(full_name)')
        .eq('device_number', deviceNumber)
        .eq('event_id', ev.event_id)
        .maybeSingle()

      if (!dev || !dev.team_id) {
        setError(`ยังไม่มีการตั้งค่าเครื่อง #${deviceNumber} สำหรับงาน "${ev.event_name}" — กรุณาแจ้ง Admin`)
        setLoading(false)
        return
      }

      setMapping({
        teamId:    dev.team_id,
        judgeId:   dev.judge_id,
        teamName:  dev.teams?.team_name,
        judgeName: dev.judges?.full_name,
      })

      const { data: state } = await supabase
        .from('event_state').select('active_station, bls_mode').eq('event_id', ev.event_id).maybeSingle()
      setActiveStation(state?.active_station || 'IDLE')
      setBlsMode(state?.bls_mode || 'manual')

      setLoading(false)
    }
    load()

    // ฟังการเปลี่ยนฐานของ Master แบบเรียลไทม์ (เฉพาะของงานนี้เท่านั้น กรองด้วย event_id ใน callback)
    const sub = supabase.channel(`device-${deviceNumber}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'event_state' },
        (payload) => {
          if (payload.new.event_id !== eventIdRef.current) return // ไม่ใช่งานปัจจุบัน ไม่สนใจ
          setActiveStation(payload.new.active_station)
          setBlsMode(payload.new.bls_mode || 'manual')
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_assignments',
          filter: `device_number=eq.${deviceNumber}` }, load)
      .subscribe()
    return () => supabase.removeChannel(sub)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceNumber])

  // สร้าง judge_assignment อัตโนมัติเมื่อฐานเปลี่ยนหรือทีมเปลี่ยน (ถ้ายังไม่มี)
  useEffect(() => {
    let cancelled = false

    async function ensureAssignment() {
      if (!mapping || activeStation === 'IDLE') return
      // ฐาน BLS แบบ manual ไม่ต้องมีจอกรรมการ ไม่ต้องสร้าง assignment
      if (activeStation === 'BLS' && blsMode === 'manual') return
      setAssignmentReady(false)

      try {
        const { data: existing, error: findErr } = await supabase
          .from('judge_assignments')
          .select('assignment_id')
          .eq('team_id', mapping.teamId)
          .eq('judge_id', mapping.judgeId)
          .eq('station_type', activeStation)
          .eq('status', 'active')
          .maybeSingle()

        if (findErr) {
          setError(findErr.message)
          return
        }

        let assignmentId = existing?.assignment_id || null

        if (!assignmentId) {
          // The database's partial unique index makes simultaneous page loads safe.
          // A duplicate-key response is expected when another tab wins the race.
          const { error: insertErr } = await supabase.from('judge_assignments').insert({
              judge_id: mapping.judgeId,
              team_id: mapping.teamId,
              station_type: activeStation,
              status: 'active',
              event_id: eventId,
            })

          const { data: inserted, error: refetchErr } = await supabase
            .from('judge_assignments')
            .select('assignment_id')
            .eq('team_id', mapping.teamId)
            .eq('judge_id', mapping.judgeId)
            .eq('station_type', activeStation)
            .eq('status', 'active')
            .maybeSingle()

          if (refetchErr || !inserted?.assignment_id) {
            setError(refetchErr?.message || insertErr?.message || 'ไม่พบ assignment ที่พร้อมใช้งาน')
            return
          }

          assignmentId = inserted.assignment_id
        }

        if (!cancelled && assignmentId) {
          setAssignmentReady(true)
        }
      } catch (err) {
        setError(err?.message || 'ไม่สามารถเตรียมฐานกรรมการได้')
      }
    }
    ensureAssignment()
    return () => { cancelled = true }
  }, [mapping, activeStation, blsMode, eventId])

  const needsAssignment = activeStation !== 'IDLE' && !(activeStation === 'BLS' && blsMode === 'manual')
  if (loading || (needsAssignment && !assignmentReady)) return <div className="screen"><p style={{ color: 'var(--muted)', marginTop: 24 }}>กำลังโหลด...</p></div>

  if (error) return (
    <div className="screen">
      <div className="warn-banner" style={{ marginTop: 24 }}>⚠ {error}</div>
    </div>
  )

  if (activeStation === 'IDLE') return (
    <div className="screen">
      <div style={{ marginTop: 60, textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>เครื่อง #{deviceNumber} — {mapping.teamName}</div>
        <div style={{ fontFamily: 'JetBrains Mono,monospace', color: 'var(--muted)', marginTop: 8 }}>
          กรรมการ: {mapping.judgeName}
        </div>
        <div className="warn-banner" style={{ marginTop: 20 }}>⚠ Master ยังไม่เปิดรอบแข่งขัน — รอสักครู่</div>
      </div>
    </div>
  )

  if (activeStation === 'BLS') {
    if (blsMode === 'judged') {
      // โหมด 3.2 — หน้าจอกรรมการแบบเดิม (กรอกคะแนน + จับเวลา)
      return <JudgeBLS teamId={mapping.teamId} judgeId={mapping.judgeId} judgeName={mapping.judgeName} eventId={eventId} />
    }
    // โหมด 3.1 (ค่าเริ่มต้น) — Admin กรอกอันดับเองที่หน้า Master แทน
    return (
      <div className="screen" style={{ marginTop: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🫀</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>ฐาน BLS — ไม่ใช้หน้าจอนี้ในโหมดนี้</div>
        <div style={{ fontFamily: 'JetBrains Mono,monospace', color: 'var(--muted)', fontSize: 13 }}>
          ตัดสินจากทีมที่ทำครบ 5 คนก่อน แล้วให้ Admin กรอกอันดับที่หน้า Master → 🫀 BLS ผลการแข่งขัน
        </div>
      </div>
    )
  }
  if (activeStation === 'ECG')       return <JudgeECG  teamId={mapping.teamId} judgeId={mapping.judgeId} judgeName={mapping.judgeName} eventId={eventId} />
  if (activeStation === 'ALGORITHM') return <JudgeAlgo teamId={mapping.teamId} judgeId={mapping.judgeId} judgeName={mapping.judgeName} eventId={eventId} />

  return (
    <div className="screen">
      <div className="warn-banner" style={{ marginTop: 24 }}>⚠ ฐาน "{activeStation}" ยังไม่รองรับหน้าจอนี้</div>
    </div>
  )
}
