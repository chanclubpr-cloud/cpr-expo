// src/lib/currentEvent.js
// ============================================================
// ตัวช่วยกลางสำหรับระบบหลายงานแข่งขัน — ทุกหน้าจอในแอปเรียกใช้ไฟล์นี้
// เพื่อรู้ว่า "งานแข่งขันไหนกำลังเปิดอยู่ตอนนี้" แทนการเดาหรือ hardcode
//
// โครงสร้าง: ตาราง `events` เก็บแค่ชื่องาน+สถานะเปิดอยู่หรือไม่
//            ตาราง `event_state` (เดิม) เก็บสถานะการแข่ง (ฐาน/โหมด ฯลฯ)
//            ผูกกันด้วย event_id — 1 งาน = 1 แถวใน event_state เสมอ
// ============================================================

import { supabase } from './supabase'

// ดึงงานแข่งขันที่กำลัง "เปิดใช้งานอยู่" (is_current = true) — มีได้แค่งานเดียวเสมอ
export async function getCurrentEvent() {
  const { data, error } = await supabase
    .from('events').select('*').eq('is_current', true).maybeSingle()
  if (error || !data) return null
  return data
}

export async function getCurrentEventId() {
  const ev = await getCurrentEvent()
  return ev?.event_id || null
}

// ดึงรายการงานทั้งหมด (ใหม่ล่าสุดก่อน) — ใช้แสดงประวัติงานเก่า
export async function listAllEvents() {
  const { data } = await supabase.from('events').select('*').order('created_at', { ascending: false })
  return data || []
}

// สร้างงานแข่งขันใหม่ + ตั้งเป็นงานปัจจุบันทันที (งานเก่าจะกลายเป็นเก็บถาวร/อ่านอย่างเดียว)
// สร้างทั้งแถวใน events และแถว event_state คู่กันเสมอ (ห้ามมีงานไหนไม่มี event_state)
export async function createNewEvent(eventName) {
  if (!eventName?.trim()) return { error: { message: 'กรุณาตั้งชื่องาน' } }

  // ปิดงานเดิมทั้งหมดก่อน (ให้เหลือ is_current=true แค่งานเดียวเสมอ)
  await supabase.from('events').update({ is_current: false }).eq('is_current', true)

  const { data: newEvent, error: evErr } = await supabase.from('events').insert({
    event_name: eventName.trim(),
    is_current: true,
  }).select().single()

  if (evErr) return { error: evErr }

  const { error: stateErr } = await supabase.from('event_state').insert({
    event_id: newEvent.event_id,
    active_station: 'IDLE',
    registration_open: true,
    total_teams_registered: 5,
    megacode_mode: 'separate',
    bls_mode: 'manual',
  })
  if (stateErr) return { error: stateErr }

  return { data: newEvent }
}
