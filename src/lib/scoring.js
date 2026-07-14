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
//
// v3: แก้บั๊กสำคัญ 2 จุด (เจอจากสถานการณ์จริง — ทีมสัญญาณหลุดกลางฐาน ECG)
//   1) เดิมบันทึกคะแนนทุกทีม "เป็นก้อนเดียว" (upsert หลายแถวพร้อมกัน) ถ้าทีมใด
//      ทีมหนึ่งมีข้อมูลเวลาพัง (เช่น started_at หายเพราะสัญญาณหลุดตอนเริ่ม)
//      จะทำให้การบันทึกทั้งก้อนล้มเหลว — ทีมอื่นที่ข้อมูลปกติก็พลอยไม่ได้คะแนนไปด้วย
//      ทั้งที่ทำถูกต้องทุกอย่าง แก้โดยเปลี่ยนเป็นบันทึก "ทีละทีม" ทีมไหนพังก็ไม่ทำให้ทีมอื่นพังตาม
//   2) เดิมถ้า started_at/finished_at หายไป จะคำนวณเวลาได้เป็น NaN (สาเหตุของข้อ 1)
//      แก้โดยซ่อมเวลาที่หายไปจาก "เวลาจริงที่กรรมการกดตัดสิน" ในตาราง attempts แทน
//      (ใช้ attempts แรกสุด/ล่าสุดของทีมนั้นแทน started_at/finished_at ที่หายไป)
//      ถ้าซ่อมไม่ได้เลยจริงๆ (ไม่มีประวัติการตัดสินเหลืออยู่เลย) ทีมนั้นจะถูกจัดไว้
//      "ท้ายตารางเสมอ" แทนการเดาเวลาแบบผิดๆ หรือปล่อยให้พังทั้งก้อน
// ============================================================

import { supabase } from './supabase'

// ตารางแต้มคงที่ — ไม่ผูกกับจำนวนทีม (อันดับ 6 ขึ้นไปได้ 0 แต้ม)
export const FIXED_POINTS = { 1: 5, 2: 4, 3: 3, 4: 2, 5: 1 }
export function pointsForRank(rank) { return FIXED_POINTS[rank] || 0 }

// บันทึกผลทีละทีม (ไม่ใช่ก้อนเดียว) — ทีมไหนบันทึกไม่สำเร็จ (ข้อมูลพัง/เชื่อมต่อมีปัญหา)
// จะไม่ทำให้ทีมอื่นที่ข้อมูลปกติพลอยไม่ได้คะแนนไปด้วย ต่างจากเดิมที่ upsert รวมทีเดียวทั้งหมด
// แล้วถ้าแถวใดแถวหนึ่งมีปัญหา (เช่น total_time_seconds เป็น NaN) จะทำให้ล้มเหลวทั้งก้อน
async function saveStationResultsSafely(rows, stationType) {
  const failed = []
  for (const row of rows) {
    const { error } = await supabase.from('station_results').upsert(row, { onConflict: 'team_id,station_type' })
    if (error) {
      failed.push({ team_id: row.team_id, message: error.message })
      console.error(`[scoring] บันทึกคะแนนฐาน ${stationType} ของทีม ${row.team_id} ไม่สำเร็จ:`, error)
    }
  }
  if (failed.length > 0) {
    console.error(`[scoring] มี ${failed.length} ทีมที่บันทึกคะแนนฐาน ${stationType} ไม่สำเร็จ (ทีมอื่นบันทึกสำเร็จตามปกติ):`, failed)
  }
  return failed
}

export async function finalizeStationResult(stationType, eventId) {
  if (!eventId) {
    console.error('[scoring] finalizeStationResult ถูกเรียกโดยไม่มี eventId — ยกเลิกการคำนวณเพื่อป้องกันข้อมูลปนกันข้ามงาน')
    return
  }

  const { data: state } = await supabase
    .from('event_state').select('total_teams_registered').eq('event_id', eventId).maybeSingle()
  const totalTeams = state?.total_teams_registered || 5

  // หาทีมทั้งหมดของ "งานนี้เท่านั้น" กันผลจากงานเก่าปนเข้ามา
  const { data: teamRows } = await supabase.from('teams').select('team_id').eq('event_id', eventId)
  const teamIds = (teamRows || []).map(t => t.team_id)
  if (teamIds.length === 0) return

  if (stationType === 'BLS') {
    await finalizeBLS(totalTeams, teamIds, eventId)
  } else {
    await finalizeTimeBased(stationType, totalTeams, teamIds, eventId)
  }
}

// ============================================================
// BLS — จัดกลุ่มตาม "จำนวนรอบที่ใช้" ก่อน แล้วตัดสินด้วยคะแนนเฉลี่ย
// ============================================================
async function finalizeBLS(totalTeams, teamIds, eventId) {
  const { data: assignments } = await supabase
    .from('judge_assignments')
    .select('team_id')
    .eq('station_type', 'BLS')
    .eq('status', 'finished')
    .in('team_id', teamIds)

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
      const roundNeeded = passIdx + 1 // จำนวนรอบยึดตามครั้งแรกที่ผ่านจริงระหว่างสอบ (ข้อเท็จจริงทางเวลา ไม่เปลี่ยนตามการแก้ไขคะแนนภายหลัง)
      maxRoundNeeded = Math.max(maxRoundNeeded, roundNeeded)

      // คะแนนใช้ "ครั้งล่าสุด" ที่ผลเป็น pass เสมอ (รองรับกรณีกรรมการกดแก้ไขคะแนนภายหลัง
      // ผ่านปุ่ม "แก้ไขผล" ซึ่งจะเพิ่มประวัติใหม่ ไม่ได้แก้ของเดิม — ถ้าใช้ own[passIdx] เฉยๆ
      // จะได้คะแนนครั้งแรกที่อาจถูกแก้ไขไปแล้ว ทำให้อันดับคลาดเคลื่อนจากคะแนนจริงล่าสุด)
      const allPassAttempts = own.filter(x => x.result === 'pass')
      const latestPass = allPassAttempts[allPassAttempts.length - 1]
      passScores.push(Number(latestPass.score) || 0)
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
      points: pointsForRank(currentRank),
      calculated_at: new Date().toISOString(),
      event_id: eventId,
    })
  }

  await saveStationResultsSafely(rows, 'BLS')
}

// ============================================================
// ECG / Algorithm — ใช้เวลาเป็นตัวจัดอันดับ (ทีมไหนใช้เวลารวมน้อยกว่าชนะ)
//
// v3: ถ้า started_at/finished_at ของทีมไหนหายไป (เช่นสัญญาณหลุดตอนเริ่มฐาน)
// จะซ่อมด้วยเวลาจริงจากประวัติการตัดสิน (ตาราง attempts — ทุกครั้งที่กรรมการกด
// "ผ่าน"/"ไม่ผ่าน"/หมดเวลา จะมีบันทึกเวลาไว้เสมอ) แทนที่จะปล่อยให้คำนวณเป็น NaN
// ซึ่งจะทำให้บันทึกคะแนนของ "ทุกทีม" ล้มเหลวไปด้วย (ดูรายละเอียดที่หัวไฟล์)
// ถ้าซ่อมไม่ได้เลยจริงๆ (ไม่มีประวัติเหลืออยู่เลย) ทีมนั้นจะถูกจัดไว้ท้ายตารางเสมอ
// แทนการเดาเวลาแบบผิดๆ — ตรงกับหลักการ "ไม่มีข้อมูลจริง = ไม่ควรได้เปรียบทีมที่มีข้อมูลจริง"
// ============================================================
async function finalizeTimeBased(stationType, totalTeams, teamIds, eventId) {
  const { data: assignments } = await supabase
    .from('judge_assignments')
    .select('team_id, started_at, finished_at, active_duration_seconds')
    .eq('station_type', stationType)
    .eq('status', 'finished')
    .in('team_id', teamIds)

  if (!assignments || assignments.length === 0) return

  const withTime = []

  for (const a of assignments) {
    const { data: participants } = await supabase
      .from('participants').select('participant_id').eq('team_id', a.team_id)
    const participantIds = (participants || []).map(p => p.participant_id)

    const { count } = await supabase
      .from('attempts')
      .select('attempt_id', { count: 'exact', head: true })
      .eq('station_type', stationType)
      .in('participant_id', participantIds)
      .in('result', ['fail', 'timeout'])

    let startIso = a.started_at
    let endIso   = a.finished_at

    // ซ่อมเวลาที่หายไป (ถ้ามี) จากบันทึกจริงในตาราง attempts ของทีมนี้
    if ((!startIso || !endIso) && participantIds.length > 0) {
      const { data: teamAttempts } = await supabase
        .from('attempts')
        .select('created_at')
        .eq('station_type', stationType)
        .in('participant_id', participantIds)
        .order('created_at', { ascending: true })

      if (teamAttempts && teamAttempts.length > 0) {
        if (!startIso) startIso = teamAttempts[0].created_at
        if (!endIso)   endIso   = teamAttempts[teamAttempts.length - 1].created_at
      }
    }

    let totalTimeSeconds = null
    if (a.active_duration_seconds != null) {
      totalTimeSeconds = Number(a.active_duration_seconds)
    } else if (startIso && endIso) {
      const computed = (new Date(endIso) - new Date(startIso)) / 1000
      if (Number.isFinite(computed) && computed >= 0) totalTimeSeconds = computed
    }

    withTime.push({
      team_id: a.team_id,
      total_time_seconds: totalTimeSeconds,       // null = ไม่มีข้อมูลเวลาที่เชื่อถือได้เลย
      hasRealTiming: totalTimeSeconds != null,
      total_retry_count: count || 0,
    })
  }

  // จัดอันดับ: ทีมที่มีเวลาจริง (ไม่ว่าจะเป็นเวลาปกติหรือเวลาที่ซ่อมจาก attempts แล้ว)
  // มาก่อนเสมอ เรียงจากใช้เวลาน้อย -> มาก แล้วดูจำนวนสอบซ้ำเป็นตัวตัดสินรอง
  // ทีมที่ไม่มีข้อมูลเวลาเหลืออยู่เลย (hasRealTiming=false) ตกไปท้ายตารางเสมอ (นับเป็นกลุ่มเดียวกัน)
  withTime.sort((a, b) => {
    if (a.hasRealTiming !== b.hasRealTiming) return a.hasRealTiming ? -1 : 1
    if (!a.hasRealTiming) return 0
    return a.total_time_seconds - b.total_time_seconds || a.total_retry_count - b.total_retry_count
  })

  const rows = withTime.map((row, idx) => ({
    team_id: row.team_id,
    station_type: stationType,
    total_time_seconds: row.total_time_seconds,
    total_retry_count: row.total_retry_count,
    rank: idx + 1,
    points: pointsForRank(idx + 1),
    calculated_at: new Date().toISOString(),
    event_id: eventId,
  }))

  await saveStationResultsSafely(rows, stationType)
}
