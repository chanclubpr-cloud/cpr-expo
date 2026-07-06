// src/lib/useButtonGuard.js
// ============================================================
// Hook นี้ทำหน้าที่ป้องกันการกดปุ่มซ้ำโดยไม่ตั้งใจ
//
// เปรียบเหมือน "ไฟแดง" ที่จะเปิดสีแดงทันทีที่กดปุ่มครั้งแรก
// และจะกลับเป็นสีเขียวให้กดได้อีกก็ต่อเมื่อระบบตอบกลับมาแล้ว
//
// วิธีใช้:
//   const { busy, run } = useButtonGuard()
//   <button disabled={busy} onClick={() => run(async () => { ...คำสั่ง... })}>
// ============================================================

import { useState, useCallback } from 'react'

export function useButtonGuard() {
  const [busy, setBusy] = useState(false)
  const [lastError, setLastError] = useState(null)

  const run = useCallback(async (asyncFn) => {
    if (busy) return               // กำลังทำอยู่ ไม่รับคำสั่งใหม่
    setBusy(true)
    setLastError(null)
    try {
      await asyncFn()
    } catch (err) {
      setLastError(err.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่')
      console.error('[ButtonGuard]', err)
    } finally {
      setBusy(false)               // ปลดล็อกให้กดได้อีกครั้ง
    }
  }, [busy])

  return { busy, run, lastError }
}
