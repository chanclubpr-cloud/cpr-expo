// src/lib/supabase.js
// ไฟล์นี้เป็นตัวเชื่อมระหว่าง React app กับ Supabase
// เปรียบได้กับ "สายโทรศัพท์" ที่ทุกหน้าจอใช้ร่วมกัน

import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('กรุณาตั้งค่า VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY ในไฟล์ .env')
}

export const supabase = createClient(supabaseUrl, supabaseKey)
