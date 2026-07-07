// src/lib/scoring.js
// ============================================================
// ฟังก์ชันนี้แก้ปัญหา "คะแนนไม่ขึ้น Leaderboard"
// สาเหตุเดิม: ไม่มีโค้ดส่วนไหนคำนวณอันดับ+แต้มแล้วบันทึกลงตาราง
// station_results เลย ทำให้ Leaderboard (ที่อ่านจากตารางนี้) ว่างเปล่า
//
// ต้องเรียกฟังก์ชันนี้ทุกครั้งที่ "ทีมใดทีมหนึ่งแข่งจบฐานใดฐานหนึ่ง"
// ============================================================

import { supabase } from './supabase'

export async function finalizeStationResult(stationType) {
  // 1) ดึงจำนวนทีมทั้งหมดที่ลงทะเบียนไว้ (Admin ตั้งค่า) เพื่อคำนวณแต้ม
  const { data: state } = await supabase
    .from('event_state').select('total_teams_registered').single()
  const totalTeams = state?.total_teams_registered || 5

  // 2) ดึงทุกทีมที่ "จบฐานนี้แล้ว" (status = finished) พร้อมเวลาเริ่ม-จบ
  //    active_duration_seconds = เวลาทำงานจริงสะสม (ไม่รวมช่วงรีเซ็ตหุ่น) — ใช้เฉพาะฐาน BLS
  const { data: assignments } = await supabase
    .from('judge_assignments')
    .select('team_id, started_at, finished_at, active_duration_seconds')
    .eq('station_type', stationType)
    .eq('status', 'finished')

  if (!assignments || assignments.length === 0) return

  // 3) คำนวณเวลารวมของแต่ละทีม (วินาที)
  //    ถ้ามี active_duration_seconds (บันทึกไว้เฉพาะ BLS) ให้ใช้ค่านั้นแทน
  //    เพราะสะท้อน "เวลาทำ CPR จริง" ไม่ปนเวลารีเซ็ตหุ่นที่แต่ละทีมเจอไม่เท่ากัน
  const withTime = assignments.map(a => ({
    team_id: a.team_id,
    total_time_seconds: a.active_duration_seconds != null
      ? Number(a.active_duration_seconds)
      : (new Date(a.finished_at) - new Date(a.started_at)) / 1000,
  }))

  // 4) ดึงจำนวนครั้งสอบซ้ำรวมของแต่ละทีม (นับจาก attempts ที่ไม่ผ่าน)
  for (const row of withTime) {
    const { data: participants } = await supabase
      .from('participants').select('participant_id').eq('team_id', row.team_id)
    const participantIds = (participants || []).map(p => p.participant_id)

    const { count } = await supabase
      .from('attempts')
      .select('attempt_id', { count: 'exact', head: true })
      .eq('station_type', stationType)
      .in('participant_id', participantIds)
      .in('result', ['fail', 'timeout'])

    row.total_retry_count = count || 0
  }

  // 5) จัดอันดับ: เวลาน้อยกว่า = ดีกว่า, ถ้าเวลาเท่ากันใช้จำนวนครั้งสอบซ้ำ (น้อยกว่า = ดีกว่า)
  withTime.sort((a, b) =>
    a.total_time_seconds - b.total_time_seconds ||
    a.total_retry_count - b.total_retry_count
  )

  // 6) แปลงอันดับเป็นแต้ม: แต้ม = จำนวนทีมทั้งหมด - อันดับ + 1
  const rows = withTime.map((row, idx) => ({
    team_id: row.team_id,
    station_type: stationType,
    total_time_seconds: row.total_time_seconds,
    total_retry_count: row.total_retry_count,
    rank: idx + 1,
    points: Math.max(totalTeams - (idx + 1) + 1, 0),
    calculated_at: new Date().toISOString(),
  }))

  // 7) บันทึกลง station_results (upsert: ถ้ามีอยู่แล้วให้แก้ทับ)
  await supabase.from('station_results').upsert(rows, { onConflict: 'team_id,station_type' })
}
