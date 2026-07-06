// src/lib/serverTime.js
// ============================================================
// เหตุผลที่ต้องมีไฟล์นี้:
//   นาฬิกาของ Laptop แต่ละเครื่องอาจเร็ว/ช้าต่างกัน 5-30 วินาที
//   ถ้าใช้เวลาเครื่องกรรมการตัดสินอันดับจะไม่ยุติธรรม
//   ทางออกคือดึง timestamp จาก Supabase server (นาฬิกากลาง)
//   แล้วคำนวณ "ห่างจากเวลาเริ่มต้น" แทนการนับเวลาบนเครื่องเอง
// ============================================================

import { supabase } from './supabase'

/**
 * ดึงเวลาปัจจุบันจาก Supabase server (เป็น milliseconds)
 * ใช้ SQL function now() ซึ่งเป็นเวลา server จริงๆ ไม่ใช่เครื่อง client
 */
export async function getServerTimeMs() {
  const { data, error } = await supabase.rpc('get_server_time')
  if (error || !data) {
    // fallback ถ้าดึงไม่ได้ ใช้เวลาเครื่องแทนชั่วคราว
    console.warn('ไม่สามารถดึงเวลา server ได้ ใช้เวลาเครื่องแทน')
    return Date.now()
  }
  return new Date(data).getTime()
}

/**
 * คำนวณเวลาที่ใช้จริง (วินาที) จาก timestamp เริ่มต้น
 * โดยดึง timestamp ปัจจุบันจาก server ทุกครั้ง
 */
export async function getElapsedSeconds(startedAtIso) {
  const nowMs    = await getServerTimeMs()
  const startMs  = new Date(startedAtIso).getTime()
  return Math.round((nowMs - startMs) / 1000)
}
