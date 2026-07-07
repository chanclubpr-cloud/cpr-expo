// src/lib/scoring.js
// ============================================================
// ฟังก์ชันคำนวณอันดับ+แต้ม บันทึกลง station_results (ให้ Leaderboard อ่านค่า)
//
// v2: ฐาน BLS เปลี่ยนวิธีจัดอันดับใหม่ทั้งหมด (ตามที่ทีมงานยืนยัน)
//   - ไม่ใช้เวลาอีกต่อไป (ตัดปัญหาความแม่นยำการจับเวลาของกรรมการ
//     และความไม่เท่าเทียมจากการรีเซ็ตหุ่นที่แต่ละทีมเจอไม่เท่ากัน)
//   - ใช้ "จำนวนรอบที่ใช้" เป็นตัวจัดกลุ่มหลัก (ทีมที่ผ่านเร็วกว่า
//     ในแง่จำนวนรอบ จะอยู่กลุ่มบนเสมอ ไม่ว่าคะแนนเฉลี่ยเท่าไหร่)
//   - ภายในกลุ่มเดียวกัน ใช้ "คะแนนเฉลี่ยของรอบที่ผ่านจริง" ตัดสิน
//   - ฐาน ECG/Algorithm ยังใช้เวลาเป็นตัวจัดอันดับเหมือนเดิม (ไม่เปลี่ยน)
// ============================================================

import { supabase } from './supabase'

export async function finalizeStationResult(stationType) {
  const { data: state } = await supabase
    .from('event_state').select('total_teams_registered').single()
  const totalTeams = state?.total_teams_registered || 5

  if (stationType === 'BLS') {
    await finalizeBLS(totalTeams)
  } else {
    await finalizeTimeBased(stationType, totalTeams)
  }
}

// ============================================================
// BLS — จัดกลุ่มตาม "จำนวนรอบที่ใช้" ก่อน แล้วตัดสินด้วยคะแนนเฉลี่ย
// ============================================================
async function finalizeBLS(totalTeams) {
  const { data: assignments } = await supabase
    .from('judge_assignments')
    .select('team_id')
    .eq('station_type', 'BLS')
    .eq('status', 'finished')

  if (!assignments || assignments.length === 0) return

  const teamStats = []

  for (const a of assignments) {
    const { data: members } = await supabase
      .from('participants').select('participant_id')
      .eq('team_id', a.team_id).eq('is_reserve', false)
    const participantIds = (members || []).map(m => m.participant_id)
    if (participantIds.length === 0) continue

    const { data: attempts } = await supabase
      .from('attempts')
      .select('participant_id, result, score, created_at')
      .eq('station_type', 'BLS')
      .in('participant_id', participantIds)
      .order('created_at', { ascending: true })

    let maxRoundNeeded = 1
    let passScores = []
    let totalRetries = 0

    for (const pid of participantIds) {
      const own = (attempts || []).filter(x => x.participant_id === pid)
      const passIdx = own.findIndex(x => x.result === 'pass')
      if (passIdx === -1) continue
      const roundNeeded = passIdx + 1
      maxRoundNeeded = Math.max(maxRoundNeeded, roundNeeded)
      passScores.push(Number(own[passIdx].score) || 0)
      totalRetries += passIdx
    }

    const avgScore = passScores.length
      ? passScores.reduce((s, v) => s + v, 0) / passScores.length
      : 0

    teamStats.push({
      team_id: a.team_id,
      round_tier: maxRoundNeeded,       // เกณฑ์ที่ 1 — ยิ่งน้อยยิ่งดี
      avg_score: Math.round(avgScore * 100) / 100, // ปัดทศนิยม 2 ตำแหน่ง กันปัญหาจุดทศนิยมเปรียบเทียบไม่ตรง
      total_retry_count: totalRetries,  // เกณฑ์ที่ 3 — ยิ่งน้อยยิ่งดี
    })
  }

  // จัดอันดับ: รอบน้อยกว่าก่อน > คะแนนเฉลี่ยมากกว่าดีกว่า > สอบซ้ำน้อยกว่าดีกว่า
  // เวลาไม่ใช้ตัดสินอีกต่อไป (สอบตายตัว 2 นาที/คน จึงไม่มีความหมายเชิงเปรียบเทียบ)
  teamStats.sort((a, b) =>
    a.round_tier - b.round_tier ||
    b.avg_score - a.avg_score ||
    a.total_retry_count - b.total_retry_count
  )

  // จัดอันดับแบบ "อันดับร่วม" (Competition Ranking) — ถ้าทั้ง 3 เกณฑ์เท่ากันเป๊ะ
  // ให้ถือว่าอยู่อันดับเดียวกัน แล้วอันดับถัดไปข้ามเลขไปตามจำนวนทีมที่เสมอกัน
  // เช่น อันดับ 1, 1, 3, 4 (ไม่ใช่ 1, 2, 3, 4) — เหมือนกติกาสากลเวลามีผลเสมอกันเป๊ะ
  const rows = []
  let currentRank = 1
  for (let i = 0; i < teamStats.length; i++) {
    const t = teamStats[i]
    if (i > 0) {
      const prev = teamStats[i - 1]
      const isTie = t.round_tier === prev.round_tier &&
                    t.avg_score === prev.avg_score &&
                    t.total_retry_count === prev.total_retry_count
      if (!isTie) currentRank = i + 1
    }
    rows.push({
      team_id: t.team_id,
      station_type: 'BLS',
      total_time_seconds: null, // ไม่ใช้เวลาตัดสินฐานนี้ (สอบตายตัว 2 นาที/คน)
      total_retry_count: t.total_retry_count,
      rank: currentRank,
      points: Math.max(totalTeams - currentRank + 1, 0),
      calculated_at: new Date().toISOString(),
    })
  }

  await supabase.from('station_results').upsert(rows, { onConflict: 'team_id,station_type' })
}

// ============================================================
// ECG / Algorithm — ใช้เวลาเป็นตัวจัดอันดับ (เหมือนเดิม ไม่เปลี่ยน)
// ============================================================
async function finalizeTimeBased(stationType, totalTeams) {
  const { data: assignments } = await supabase
    .from('judge_assignments')
    .select('team_id, started_at, finished_at, active_duration_seconds')
    .eq('station_type', stationType)
    .eq('status', 'finished')

  if (!assignments || assignments.length === 0) return

  const withTime = assignments.map(a => ({
    team_id: a.team_id,
    total_time_seconds: a.active_duration_seconds != null
      ? Number(a.active_duration_seconds)
      : (new Date(a.finished_at) - new Date(a.started_at)) / 1000,
  }))

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

  withTime.sort((a, b) =>
    a.total_time_seconds - b.total_time_seconds ||
    a.total_retry_count - b.total_retry_count
  )

  const rows = withTime.map((row, idx) => ({
    team_id: row.team_id,
    station_type: stationType,
    total_time_seconds: row.total_time_seconds,
    total_retry_count: row.total_retry_count,
    rank: idx + 1,
    points: Math.max(totalTeams - (idx + 1) + 1, 0),
    calculated_at: new Date().toISOString(),
  }))

  await supabase.from('station_results').upsert(rows, { onConflict: 'team_id,station_type' })
}
