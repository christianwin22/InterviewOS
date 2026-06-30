import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { extractPdfText } from '../lib/pdfExtract'

const INTERVIEW_TYPES = ['HR Screen', 'Hiring Manager', 'Technical', 'Behavioral', 'Panel', 'Case Study', 'Other']

const defaultForm = {
  // Section A
  name: '',
  cvText: '',
  cvPdfUrl: '',
  cvFilename: '',
  presetQA: '',
  personalBackground: '',
  additionalContext: '',
  // Section B
  interviewType: '',
  interviewTypeDetail: '',
  interviewer: '',
  expectedDuration: '',
  company: '',
  jobTitle: '',
  jobDescription: '',
  requirements: '',
  notes: '',
}

export default function ContextForm() {
  const { mode } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const fileInputRef = useRef(null)

  const [form, setForm] = useState(defaultForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadProfile()
  }, [])

  async function loadProfile() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (data) {
      setForm((prev) => ({
        ...prev,
        name: data.name || '',
        cvText: data.cv_text || '',
        cvPdfUrl: data.cv_pdf_url || '',
        cvFilename: data.cv_pdf_url ? data.cv_pdf_url.split('/').pop() : '',
        presetQA: data.preset_qa || '',
        personalBackground: data.personal_background || '',
        additionalContext: data.additional_context || '',
      }))
    }
    setLoading(false)
  }

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handlePdfSelect(e) {
    const file = e.target.files[0]
    if (!file || file.type !== 'application/pdf') return

    setPdfLoading(true)
    setError('')

    try {
      // Extract text client-side
      const text = await extractPdfText(file)

      // Upload PDF to Supabase Storage
      const filename = `${user.id}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`
      const { error: uploadError } = await supabase.storage
        .from('resumes')
        .upload(filename, file, { contentType: 'application/pdf', upsert: true })

      if (uploadError) throw uploadError

      setForm((prev) => ({
        ...prev,
        cvText: text,
        cvPdfUrl: filename,
        cvFilename: file.name,
      }))
    } catch (err) {
      setError('Failed to process PDF. Please try again.')
      console.error(err)
    }

    setPdfLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    // Save Section A to profile
    const { error: profileError } = await supabase.from('profiles').upsert({
      user_id: user.id,
      name: form.name,
      cv_text: form.cvText,
      cv_pdf_url: form.cvPdfUrl,
      preset_qa: form.presetQA,
      personal_background: form.personalBackground,
      additional_context: form.additionalContext,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    if (profileError) {
      setError('Failed to save profile. Please try again.')
      setSaving(false)
      return
    }

    // Store full context in sessionStorage for the mode page
    sessionStorage.setItem('interviewContext', JSON.stringify(form))

    navigate(`/${mode}`)
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-screen"><div className="spinner" /></div>
      </div>
    )
  }

  const modeLabel = mode === 'interview' ? 'Interview' : 'Practice'

  return (
    <div className="page">
      <div className="nav-bar">
        <button className="nav-back" onClick={() => navigate('/')}>
          ← Back
        </button>
        <span className="nav-title">Session setup</span>
        <div style={{ width: 60 }} />
      </div>

      <form className="form-scroll" onSubmit={handleSubmit}>
        <div className="container">
          {error && <div className="error-box" style={{ marginTop: 16 }}>{error}</div>}

          {/* Section A */}
          <div className="section-title">A — Your profile</div>

          <div className="form-group">
            <label className="form-label">Full name</label>
            <input
              className="form-input"
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Alex Chen"
              autoCapitalize="words"
            />
          </div>

          <div className="form-group">
            <label className="form-label">CV / Resume (PDF)</label>
            <div
              className={`upload-area ${form.cvFilename ? 'has-file' : ''}`}
              onClick={() => fileInputRef.current?.click()}
            >
              {pdfLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <div className="spinner" style={{ width: 18, height: 18 }} />
                  <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Processing PDF…</span>
                </div>
              ) : form.cvFilename ? (
                <div>
                  <div style={{ fontSize: 14, color: 'var(--blue)', fontWeight: 500 }}>📄 {form.cvFilename}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Tap to replace</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>📎</div>
                  <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Tap to upload your CV / Resume</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>PDF only</div>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handlePdfSelect}
              style={{ display: 'none' }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Preset Q&A</label>
            <textarea
              className="form-textarea"
              value={form.presetQA}
              onChange={(e) => set('presetQA', e.target.value)}
              placeholder="Common questions and your prepared answers…"
              style={{ minHeight: 120 }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Personal background</label>
            <textarea
              className="form-textarea"
              value={form.personalBackground}
              onChange={(e) => set('personalBackground', e.target.value)}
              placeholder="Your background, experiences, and key achievements…"
              style={{ minHeight: 100 }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Additional context</label>
            <textarea
              className="form-textarea"
              value={form.additionalContext}
              onChange={(e) => set('additionalContext', e.target.value)}
              placeholder="Anything else the AI should know about you…"
            />
          </div>

          {/* Section B */}
          <div className="section-title">B — This session</div>

          <div className="form-group">
            <label className="form-label">Interview type</label>
            <select
              className="form-select"
              value={form.interviewType}
              onChange={(e) => set('interviewType', e.target.value)}
            >
              <option value="">Select type…</option>
              {INTERVIEW_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Add more detail or specify</label>
            <input
              className="form-input"
              type="text"
              value={form.interviewTypeDetail}
              onChange={(e) => set('interviewTypeDetail', e.target.value)}
              placeholder="e.g. System design round, culture fit…"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Interviewer name (if known)</label>
            <input
              className="form-input"
              type="text"
              value={form.interviewer}
              onChange={(e) => set('interviewer', e.target.value)}
              placeholder="Jane Smith"
              autoCapitalize="words"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Expected duration</label>
            <input
              className="form-input"
              type="text"
              value={form.expectedDuration}
              onChange={(e) => set('expectedDuration', e.target.value)}
              placeholder="e.g. 45 minutes"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Company name</label>
            <input
              className="form-input"
              type="text"
              value={form.company}
              onChange={(e) => set('company', e.target.value)}
              placeholder="Google"
              autoCapitalize="words"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Job title</label>
            <input
              className="form-input"
              type="text"
              value={form.jobTitle}
              onChange={(e) => set('jobTitle', e.target.value)}
              placeholder="Senior Product Manager"
              autoCapitalize="words"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Job description and responsibilities</label>
            <textarea
              className="form-textarea"
              value={form.jobDescription}
              onChange={(e) => set('jobDescription', e.target.value)}
              placeholder="Paste the job description here…"
              style={{ minHeight: 120 }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Requirements</label>
            <textarea
              className="form-textarea"
              value={form.requirements}
              onChange={(e) => set('requirements', e.target.value)}
              placeholder="Key skills and qualifications required…"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Additional notes</label>
            <textarea
              className="form-textarea"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Anything specific you want the AI to focus on…"
            />
          </div>
        </div>
      </form>

      <div className="form-footer">
        <div className="container">
          <button
            className={`btn ${mode === 'practice' ? 'btn-green' : 'btn-primary'}`}
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? 'Saving…' : `Save profile & start ${modeLabel}`}
          </button>
        </div>
      </div>
    </div>
  )
}
