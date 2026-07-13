// src/lib/adminAuth.js
// ============================================================
// ระบบรหัสผ่านแบบง่าย สำหรับกันคนทั่วไปเดาเข้า Admin+Master มั่วๆ
// (ไม่ใช่ระบบ Login จริง — คนที่เปิดดูโค้ดเจอรหัสได้ ใช้กันแค่คนทั่วไปพอ)
//
// ต้องการความปลอดภัยจริงจังกว่านี้ในอนาคต ให้เปลี่ยนไปใช้ Supabase Auth แทน
// ============================================================

const ADMIN_PASSWORD = 'qshc2026' // เปลี่ยนรหัสผ่านได้ที่นี่
const SESSION_KEY = 'admin_authed'

export function isAdminAuthed() {
  return sessionStorage.getItem(SESSION_KEY) === 'true'
}

export function tryAdminLogin(password) {
  if (password === ADMIN_PASSWORD) {
    sessionStorage.setItem(SESSION_KEY, 'true')
    return true
  }
  return false
}

export function adminLogout() {
  sessionStorage.removeItem(SESSION_KEY)
}
