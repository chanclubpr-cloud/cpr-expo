// src/components/QuestionManager.jsx
// ============================================================
// ฟอร์มเพิ่ม/แก้ไขโจทย์ ECG (อัปโหลดภาพ/คลิปเข้า Supabase Storage โดยตรง)
// และโจทย์ Algorithm (ตัวเลือก 4 ข้อ) — ไม่ต้องเข้า Supabase เอง
//
// ข้อกำหนดล่วงหน้า: ต้องมี Storage bucket ชื่อ "ecg-media" (ตั้งเป็น Public)
// สร้างได้จาก Supabase Dashboard → Storage → New bucket (ทำครั้งเดียว)
// ============================================================

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const BUCKET = 'ecg-media'

export default function QuestionManager() {
  const [tab, setTab] = useState('ecg') // 'ecg' | 'algo'
  return (
    <div className="card-highlight" style={{ marginTop: 16 }}>
      <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 10, letterSpacing: '.06em' }}>
        📋 คลังโจทย์
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['ecg', 'โจทย์ ECG'], ['algo', 'โจทย์ Algorithm']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '8px 16px', borderRadius: 16, cursor: 'pointer',
            border: `1px solid ${tab === k ? 'var(--ecg)' : 'var(--line)'}`,
            background: tab === k ? 'var(--ecg)' : 'transparent',
            color: tab === k ? '#04170D' : 'var(--muted)',
            fontFamily: 'Sarabun,sans-serif', fontWeight: 700, fontSize: 13,
          }}>{label}</button>
        ))}
      </div>
      {tab === 'ecg' ? <ECGForm /> : <AlgoForm />}
    </div>
  )
}

// ================= ฟอร์มโจทย์ ECG =================
function ECGForm() {
  const [list, setList] = useState([])
  const [editingId, setEditingId] = useState(null) // null = โหมดเพิ่มใหม่, มีค่า = กำลังแก้ไขข้อนี้
  const [code, setCode] = useState('')
  const [answerKey, setAnswerKey] = useState('')
  const [order, setOrder] = useState(1)
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const { data } = await supabase.from('ecg_questions').select('*').order('display_order')
    setList(data || [])
  }
  useEffect(() => { load() }, [])

  function startEdit(q) {
    setEditingId(q.question_id)
    setCode(q.question_code || '')
    setAnswerKey(q.answer_key || '')
    setOrder(q.display_order || 1)
    setFile(null) // ไม่บังคับอัปโหลดไฟล์ใหม่ตอนแก้ไข — ใช้ไฟล์เดิมถ้าไม่เลือกใหม่
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setCode(''); setAnswerKey(''); setOrder(1); setFile(null); setError('')
  }

  async function handleSubmit() {
    setError('')
    if (!code.trim()) { setError('กรุณากรอกรหัสโจทย์'); return }
    if (!editingId && !file) { setError('กรุณาเลือกไฟล์ภาพ/คลิป'); return }
    setUploading(true)

    let mediaType, mediaUrl
    if (file) {
      // มีไฟล์ใหม่ → อัปโหลดทับ (ใช้ทั้งตอนเพิ่มใหม่และตอนแก้ไขแล้วเปลี่ยนไฟล์)
      mediaType = file.type.startsWith('video') ? 'video' : 'image'
      const path = `${Date.now()}-${file.name}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file)
      if (upErr) {
        setError(`อัปโหลดไม่สำเร็จ: ${upErr.message} (ตรวจสอบว่ามี bucket ชื่อ "${BUCKET}" และตั้งเป็น Public แล้ว)`)
        setUploading(false)
        return
      }
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
      mediaUrl = pub.publicUrl
    }

    if (editingId) {
      // โหมดแก้ไข — อัปเดตแถวเดิม (ไม่แตะ media ถ้าไม่ได้เลือกไฟล์ใหม่)
      const updatePayload = {
        question_code: code.trim(),
        answer_key: answerKey.trim(),
        display_order: Number(order),
      }
      if (file) { updatePayload.media_type = mediaType; updatePayload.media_url = mediaUrl }

      const { error: updErr } = await supabase.from('ecg_questions').update(updatePayload).eq('question_id', editingId)
      if (updErr) setError(`บันทึกไม่สำเร็จ: ${updErr.message}`)
      else { cancelEdit(); load() }
    } else {
      // โหมดเพิ่มใหม่
      const { error: insErr } = await supabase.from('ecg_questions').insert({
        question_code: code.trim(),
        media_type: mediaType,
        media_url: mediaUrl,
        answer_key: answerKey.trim(),
        display_order: Number(order),
        is_active: true,
      })
      if (insErr) setError(`บันทึกไม่สำเร็จ: ${insErr.message}`)
      else {
        setCode(''); setAnswerKey(''); setOrder(order + 1); setFile(null)
        load()
      }
    }
    setUploading(false)
  }

  async function toggleActive(id, current) {
    await supabase.from('ecg_questions').update({ is_active: !current }).eq('question_id', id)
    load()
  }
  async function remove(id) {
    if (!confirm('ยืนยันลบโจทย์นี้?')) return
    if (editingId === id) cancelEdit()
    await supabase.from('ecg_questions').delete().eq('question_id', id)
    load()
  }

  return (
    <div>
      {editingId && (
        <div style={{ background: 'rgba(255,176,32,.08)', border: '1px solid var(--amber)', borderRadius: 8,
                       padding: '8px 14px', marginBottom: 14, fontSize: 13, color: 'var(--amber)' }}>
          ✏️ กำลังแก้ไขโจทย์ — ไม่เลือกไฟล์ใหม่ = ใช้ไฟล์เดิมต่อ
        </div>
      )}
      <div className="field">
        <label>รหัสโจทย์</label>
        <input type="text" placeholder="เช่น ECG-Q04" value={code} onChange={e => setCode(e.target.value)} />
      </div>
      <div className="field">
        <label>ไฟล์ภาพ หรือ คลิป{editingId && ' (ไม่บังคับ — เว้นว่างถ้าไม่เปลี่ยน)'}</label>
        <input type="file" accept="image/*,video/*" onChange={e => setFile(e.target.files[0])}
          style={{ width: '100%', color: 'var(--text)' }} />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>เฉลย (สำหรับกรรมการอ้างอิง)</label>
          <input type="text" value={answerKey} onChange={e => setAnswerKey(e.target.value)} />
        </div>
        <div className="field" style={{ width: 100 }}>
          <label>ลำดับ</label>
          <input type="number" value={order} onChange={e => setOrder(e.target.value)} />
        </div>
      </div>
      {error && <p style={{ color: 'var(--alert)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn-primary" onClick={handleSubmit} disabled={uploading}>
          {uploading ? 'กำลังบันทึก...' : editingId ? '💾 บันทึกการแก้ไข' : '+ เพิ่มโจทย์'}
        </button>
        {editingId && (
          <button onClick={cancelEdit} style={{
            padding: '0 20px', borderRadius: 10, border: '1px solid var(--line)',
            background: 'none', color: 'var(--muted)', cursor: 'pointer',
          }}>ยกเลิก</button>
        )}
      </div>

      <div style={{ marginTop: 18, maxHeight: 320, overflowY: 'auto' }}>
        {list.map(q => (
          <div key={q.question_id} style={{ display: 'flex', gap: 10, alignItems: 'center',
                                             padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <img src={q.media_url} alt="" style={{ width: 50, height: 38, objectFit: 'cover', borderRadius: 4,
                                                     background: 'var(--bg-deep)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 12 }}>{q.question_code}
                <span style={{ color: 'var(--muted)' }}> ({q.media_type}) — ลำดับ {q.display_order}</span></div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{q.answer_key}</div>
            </div>
            <button onClick={() => startEdit(q)} style={{
              fontFamily: 'JetBrains Mono,monospace', fontSize: 11, background: 'none',
              border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer',
            }}>แก้ไข</button>
            <button onClick={() => toggleActive(q.question_id, q.is_active)} style={{
              fontFamily: 'JetBrains Mono,monospace', fontSize: 11, background: 'none',
              border: `1px solid ${q.is_active ? 'var(--ecg)' : 'var(--line)'}`,
              color: q.is_active ? 'var(--ecg)' : 'var(--muted)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer',
            }}>{q.is_active ? 'ใช้งาน' : 'ปิดใช้'}</button>
            <button onClick={() => remove(q.question_id)} style={{
              fontFamily: 'JetBrains Mono,monospace', fontSize: 11, background: 'none',
              border: '1px solid var(--alert)', color: 'var(--alert)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer',
            }}>ลบ</button>
          </div>
        ))}
        {list.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีโจทย์ ECG</p>}
      </div>
    </div>
  )
}

// ================= ฟอร์มโจทย์ Algorithm =================
function AlgoForm() {
  const [list, setList] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [code, setCode] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [existingImageUrl, setExistingImageUrl] = useState(null)
  const [questionText, setQuestionText] = useState('')
  const [choices, setChoices] = useState({ A: '', B: '', C: '', D: '' })
  const [correct, setCorrect] = useState('A')
  const [order, setOrder] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const { data } = await supabase.from('algo_questions').select('*').order('display_order')
    setList(data || [])
  }
  useEffect(() => { load() }, [])

  function startEdit(q) {
    setEditingId(q.question_id)
    setCode(q.question_code || '')
    setQuestionText(q.question_text || '')
    setChoices({ A: q.choice_a || '', B: q.choice_b || '', C: q.choice_c || '', D: q.choice_d || '' })
    setCorrect(q.correct_choice || 'A')
    setOrder(q.display_order || 1)
    setExistingImageUrl(q.image_url || null)
    setImageFile(null)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setCode(''); setImageFile(null); setExistingImageUrl(null); setQuestionText('')
    setChoices({ A: '', B: '', C: '', D: '' }); setCorrect('A'); setOrder(1); setError('')
  }

  async function handleSubmit() {
    setError('')
    if (!code.trim() || !questionText.trim() || !choices.A || !choices.B || !choices.C || !choices.D) {
      setError('กรุณากรอกรหัสโจทย์ คำถาม และตัวเลือกให้ครบทั้ง 4 ข้อ')
      return
    }
    setSaving(true)

    let imageUrl = editingId ? existingImageUrl : null
    if (imageFile) {
      const path = `algo-${Date.now()}-${imageFile.name}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, imageFile)
      if (upErr) { setError(`อัปโหลดภาพไม่สำเร็จ: ${upErr.message}`); setSaving(false); return }
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
      imageUrl = pub.publicUrl
    }

    const payload = {
      question_code: code.trim(),
      image_url: imageUrl,
      question_text: questionText.trim(),
      choice_a: choices.A, choice_b: choices.B, choice_c: choices.C, choice_d: choices.D,
      correct_choice: correct,
      display_order: Number(order),
    }

    if (editingId) {
      const { error: updErr } = await supabase.from('algo_questions').update(payload).eq('question_id', editingId)
      if (updErr) setError(`บันทึกไม่สำเร็จ: ${updErr.message}`)
      else { cancelEdit(); load() }
    } else {
      const { error: insErr } = await supabase.from('algo_questions').insert({ ...payload, is_active: true })
      if (insErr) setError(`บันทึกไม่สำเร็จ: ${insErr.message}`)
      else {
        setCode(''); setImageFile(null); setQuestionText('')
        setChoices({ A: '', B: '', C: '', D: '' }); setCorrect('A'); setOrder(order + 1)
        load()
      }
    }
    setSaving(false)
  }

  async function toggleActive(id, current) {
    await supabase.from('algo_questions').update({ is_active: !current }).eq('question_id', id)
    load()
  }
  async function remove(id) {
    if (!confirm('ยืนยันลบโจทย์นี้?')) return
    if (editingId === id) cancelEdit()
    await supabase.from('algo_questions').delete().eq('question_id', id)
    load()
  }

  return (
    <div>
      {editingId && (
        <div style={{ background: 'rgba(255,176,32,.08)', border: '1px solid var(--amber)', borderRadius: 8,
                       padding: '8px 14px', marginBottom: 14, fontSize: 13, color: 'var(--amber)' }}>
          ✏️ กำลังแก้ไขโจทย์ — ไม่เลือกภาพใหม่ = ใช้ภาพเดิมต่อ (หรือไม่มีภาพเหมือนเดิม)
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>รหัสโจทย์</label>
          <input type="text" placeholder="เช่น ALGO-Q04" value={code} onChange={e => setCode(e.target.value)} />
        </div>
        <div className="field" style={{ width: 100 }}>
          <label>ลำดับ</label>
          <input type="number" value={order} onChange={e => setOrder(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>ภาพประกอบ (ถ้ามี — ไม่บังคับ)</label>
        {editingId && existingImageUrl && !imageFile && (
          <img src={existingImageUrl} alt="ภาพเดิม" style={{ width: 120, borderRadius: 8, marginBottom: 8, display: 'block' }} />
        )}
        <input type="file" accept="image/*" onChange={e => setImageFile(e.target.files[0])}
          style={{ width: '100%', color: 'var(--text)' }} />
      </div>
      <div className="field">
        <label>โจทย์ (ข้อความ)</label>
        <textarea value={questionText} onChange={e => setQuestionText(e.target.value)}
          rows={2} style={{ width: '100%', background: 'var(--bg-panel-2)', border: '1px solid var(--line)',
                             borderRadius: 8, color: 'var(--text)', padding: '10px 12px', fontFamily: 'Sarabun,sans-serif', fontSize: 15 }} />
      </div>
      {['A', 'B', 'C', 'D'].map(ch => (
        <div key={ch} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input type="radio" name="correct" checked={correct === ch} onChange={() => setCorrect(ch)} />
          <span style={{ fontFamily: 'JetBrains Mono,monospace', color: 'var(--ecg)', width: 16 }}>{ch}</span>
          <input type="text" placeholder={`ตัวเลือก ${ch}`} value={choices[ch]}
            onChange={e => setChoices({ ...choices, [ch]: e.target.value })} style={{ flex: 1 }} />
        </div>
      ))}
      {error && <p style={{ color: 'var(--alert)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? 'กำลังบันทึก...' : editingId ? '💾 บันทึกการแก้ไข' : '+ เพิ่มโจทย์'}
        </button>
        {editingId && (
          <button onClick={cancelEdit} style={{
            padding: '0 20px', borderRadius: 10, border: '1px solid var(--line)',
            background: 'none', color: 'var(--muted)', cursor: 'pointer',
          }}>ยกเลิก</button>
        )}
      </div>

      <div style={{ marginTop: 18, maxHeight: 320, overflowY: 'auto' }}>
        {list.map(q => (
          <div key={q.question_id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 12 }}>{q.question_code} — ลำดับ {q.display_order}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => startEdit(q)} style={{
                  fontFamily: 'JetBrains Mono,monospace', fontSize: 11, background: 'none',
                  border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer',
                }}>แก้ไข</button>
                <button onClick={() => toggleActive(q.question_id, q.is_active)} style={{
                  fontFamily: 'JetBrains Mono,monospace', fontSize: 11, background: 'none',
                  border: `1px solid ${q.is_active ? 'var(--ecg)' : 'var(--line)'}`,
                  color: q.is_active ? 'var(--ecg)' : 'var(--muted)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer',
                }}>{q.is_active ? 'ใช้งาน' : 'ปิดใช้'}</button>
                <button onClick={() => remove(q.question_id)} style={{
                  fontFamily: 'JetBrains Mono,monospace', fontSize: 11, background: 'none',
                  border: '1px solid var(--alert)', color: 'var(--alert)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer',
                }}>ลบ</button>
              </div>
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{q.question_text}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>เฉลย: ตัวเลือก {q.correct_choice}</div>
          </div>
        ))}
        {list.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีโจทย์ Algorithm</p>}
      </div>
    </div>
  )
}
