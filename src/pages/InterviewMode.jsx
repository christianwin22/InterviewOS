import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { callGemini } from '../lib/gemini'
import { useAuth } from '../contexts/AuthContext'

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', '']
  return types.find((t) => !t || MediaRecorder.isTypeSupported(t)) || ''
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function InterviewMode() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [phase, setPhase] = useState('idle') // idle | capturing | processing | showing
  const [currentAnswer, setCurrentAnswer] = useState('')
  const [liveTranscript, setLiveTranscript] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [sessionStarted, setSessionStarted] = useState(false)
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [toast, setToast] = useState('')

  const phaseRef = useRef('idle')
  const ctxRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const recognitionRef = useRef(null)
  const questionTextRef = useRef('')
  const timerRef = useRef(null)
  const conversationRef = useRef([]) // [{question, answer}]
  const sessionStartTimeRef = useRef(null)

  useEffect(() => { phaseRef.current = phase }, [phase])

  useEffect(() => {
    const stored = sessionStorage.getItem('interviewContext')
    if (!stored) { navigate('/'); return }
    ctxRef.current = JSON.parse(stored)
  }, [navigate])

  useEffect(() => {
    if (sessionStarted && !timerRef.current) {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
    }
    return () => {
      if (!sessionStarted && timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [sessionStarted])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current)
      stopRecorder()
      stopRecognition()
    }
  }, [])

  function stopRecorder() {
    const mr = mediaRecorderRef.current
    if (mr && mr.state !== 'inactive') {
      mr.stream?.getTracks().forEach((t) => t.stop())
      mr.stop()
    }
  }

  function stopRecognition() {
    if (recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
    }
  }

  async function startMediaRecorder() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    const mimeType = getSupportedMimeType()
    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {})
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data)
    }
    mr.start(1000)
    mediaRecorderRef.current = mr
    sessionStartTimeRef.current = new Date().toISOString()
    setSessionStarted(true)
  }

  const startCapturing = useCallback(async () => {
    if (!sessionStarted) {
      try {
        await startMediaRecorder()
      } catch {
        showToast('Microphone access denied. Please allow microphone access and try again.')
        return
      }
    }

    questionTextRef.current = ''
    setLiveTranscript('')
    setPhase('capturing')

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      showToast('Speech recognition is not supported on this browser.')
      setPhase('idle')
      return
    }

    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    let active = true

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          questionTextRef.current += t + ' '
        } else {
          interim = t
        }
      }
      setLiveTranscript(questionTextRef.current.trimStart() + interim)
    }

    recognition.onend = () => {
      // iOS Safari stops recognition after silence — restart if still active
      if (active && phaseRef.current === 'capturing') {
        try { recognition.start() } catch { /* already restarted */ }
      }
    }

    recognition.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      showToast(`Mic error: ${e.error}`)
    }

    recognition.start()

    recognitionRef.current = {
      stop: () => { active = false; recognition.stop() },
      abort: () => { active = false; recognition.abort() },
    }
  }, [sessionStarted])

  const stopCapturing = useCallback(async () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }

    const question = questionTextRef.current.trim()
    setLiveTranscript('')

    if (!question) {
      showToast('No speech detected. Tap again to try.')
      setPhase(conversationRef.current.length === 0 ? 'idle' : 'showing')
      return
    }

    setPhase('processing')

    const ctx = ctxRef.current
    const history = conversationRef.current
    const systemPrompt = buildSystemPrompt(ctx)
    const userPrompt = buildUserPrompt(question, history)

    try {
      const answer = await callGemini(systemPrompt, userPrompt)
      conversationRef.current = [...history, { question, answer }]
      setCurrentAnswer(answer)
      setPhase('showing')
    } catch (err) {
      showToast('Failed to get answer. Check your connection.')
      setPhase(history.length === 0 ? 'idle' : 'showing')
    }
  }, [])

  function handleCaptureButton() {
    if (phase === 'idle' || phase === 'showing') {
      startCapturing()
    } else if (phase === 'capturing') {
      stopCapturing()
    }
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  async function handleEndInterview() {
    setShowEndConfirm(false)
    setIsSaving(true)
    clearInterval(timerRef.current)

    // Stop recognition if active
    stopRecognition()

    // Stop recorder and collect audio
    let audioPath = null
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      await new Promise((resolve) => {
        mediaRecorderRef.current.onstop = resolve
        mediaRecorderRef.current.stop()
        mediaRecorderRef.current.stream?.getTracks().forEach((t) => t.stop())
      })
    }

    if (audioChunksRef.current.length > 0) {
      const mimeType = getSupportedMimeType()
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
      const blob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' })
      const filename = `${user.id}/${Date.now()}.${ext}`

      const { error } = await supabase.storage.from('recordings').upload(filename, blob, {
        contentType: mimeType || 'audio/webm',
      })
      if (!error) audioPath = filename
    }

    // Create session record
    const ctx = ctxRef.current
    const { data: session, error: sessionErr } = await supabase
      .from('sessions')
      .insert({
        user_id: user.id,
        mode: 'interview',
        company: ctx.company,
        job_title: ctx.jobTitle,
        interview_type: ctx.interviewType,
        interview_type_detail: ctx.interviewTypeDetail,
        interviewer: ctx.interviewer,
        expected_duration: ctx.expectedDuration,
        job_description: ctx.jobDescription,
        requirements: ctx.requirements,
        notes: ctx.notes,
        started_at: sessionStartTimeRef.current,
        ended_at: new Date().toISOString(),
        audio_url: audioPath,
      })
      .select()
      .single()

    if (sessionErr || !session) {
      showToast('Error saving session.')
      setIsSaving(false)
      return
    }

    // Generate report
    const conversation = conversationRef.current
    let breakdown = conversation.map((qa) => ({
      question: qa.question,
      suggested_answer: qa.answer,
      feedback: '',
    }))
    let score = null
    let justification = ''

    if (conversation.length > 0) {
      try {
        const reportRaw = await callGemini(
          'You are an expert interview coach. Return only valid JSON with no markdown.',
          buildReportPrompt(conversation)
        )
        const report = JSON.parse(reportRaw.replace(/```json\n?|\n?```/g, '').trim())
        breakdown = report.per_question_breakdown || breakdown
        score = report.overall_score ?? null
        justification = report.score_justification || ''
      } catch { /* use defaults */ }
    }

    const fullTranscript = conversation
      .map((qa, i) => `Q${i + 1}: ${qa.question}\n\nSuggested answer: ${qa.answer}`)
      .join('\n\n---\n\n')

    await supabase.from('session_reports').insert({
      session_id: session.id,
      full_transcript: fullTranscript,
      per_question_breakdown: breakdown,
      overall_score: score,
      score_justification: justification,
    })

    navigate(`/report/${session.id}`)
  }

  const captureLabel = () => {
    if (phase === 'capturing') return 'Tap to stop — end of question'
    if (phase === 'processing') return 'Getting answer…'
    if (phase === 'showing') return 'Tap to capture next question'
    return sessionStarted ? 'Tap to capture question' : 'Tap to start session'
  }

  const captureClass = () => {
    if (phase === 'capturing') return 'capture-btn capturing'
    if (phase === 'processing') return 'capture-btn processing'
    return 'capture-btn idle'
  }

  if (isSaving) {
    return (
      <div className="page">
        <div className="loading-screen">
          <div className="spinner" />
          <p>Saving session and generating report…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="interview-page">
      {/* Nav */}
      <div className="nav-bar blue">
        <div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Interview
          </div>
          <div className="elapsed-timer">{formatTime(elapsed)}</div>
        </div>

        <div className="status-pill">
          {phase === 'capturing' && <span className="pulse-dot" />}
          {phase === 'capturing' ? 'Capturing' : phase === 'processing' ? 'Processing' : sessionStarted ? 'Ready' : 'Standby'}
        </div>

        <button className="nav-action" onClick={() => setShowEndConfirm(true)}>
          End
        </button>
      </div>

      {/* Answer area */}
      <div className="answer-area">
        {currentAnswer ? (
          <div className="answer-text">{currentAnswer}</div>
        ) : (
          <div className="answer-placeholder">
            {phase === 'capturing'
              ? '🎤 Listening to question…'
              : phase === 'processing'
              ? '⏳ Generating answer…'
              : 'Your suggested answer will appear here.\n\nTap the button below to capture the interviewer\'s question.'}
          </div>
        )}
      </div>

      {/* Live transcript strip */}
      <div className="transcript-bar">
        {liveTranscript || (phase === 'capturing' ? 'Listening…' : ' ')}
      </div>

      {/* Capture button */}
      <div className="bottom-controls">
        <button
          className={captureClass()}
          onClick={handleCaptureButton}
          disabled={phase === 'processing'}
        >
          {phase === 'capturing' ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          ) : phase === 'processing' ? (
            <div className="spinner" style={{ width: 18, height: 18, borderColor: 'var(--border)', borderTopColor: 'var(--text-muted)' }} />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            </svg>
          )}
          {captureLabel()}
        </button>
      </div>

      {/* End confirm modal */}
      {showEndConfirm && (
        <div className="modal-overlay" onClick={() => setShowEndConfirm(false)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle" />
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>End interview?</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 15, marginBottom: 24 }}>
              Recording will stop and your session report will be generated.
            </p>
            <button className="btn btn-danger" onClick={handleEndInterview} style={{ marginBottom: 10 }}>
              End &amp; view report
            </button>
            <button className="btn btn-ghost" onClick={() => setShowEndConfirm(false)}>
              Continue interview
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function buildSystemPrompt(ctx) {
  return `You are an expert interview coach helping ${ctx.name || 'the candidate'} perform well in a job interview.

CANDIDATE PROFILE:
Name: ${ctx.name || 'Not provided'}
CV/Resume: ${ctx.cvText || 'Not provided'}
Personal background: ${ctx.personalBackground || 'Not provided'}
Preset Q&A: ${ctx.presetQA || 'Not provided'}
Additional context: ${ctx.additionalContext || 'Not provided'}

SESSION DETAILS:
Company: ${ctx.company || 'Not specified'}
Job title: ${ctx.jobTitle || 'Not specified'}
Interview type: ${ctx.interviewType || 'Not specified'}${ctx.interviewTypeDetail ? ` — ${ctx.interviewTypeDetail}` : ''}
Interviewer: ${ctx.interviewer || 'Not specified'}
Job description: ${ctx.jobDescription || 'Not provided'}
Requirements: ${ctx.requirements || 'Not provided'}
Notes: ${ctx.notes || 'None'}

INSTRUCTIONS:
- Respond with a concise, natural spoken-English answer the candidate can read aloud
- Keep answers under 150 words
- Use STAR format (Situation, Task, Action, Result) for behavioral questions
- Be specific and reference the candidate's background where relevant
- Sound confident, genuine, and conversational
- Do not include any meta-commentary, just the answer itself`
}

function buildUserPrompt(question, history) {
  if (history.length === 0) {
    return `The interviewer asked: "${question}"\n\nProvide a natural, concise answer under 150 words.`
  }
  const historyText = history
    .map((qa) => `Interviewer: ${qa.question}\nCandidate: ${qa.answer}`)
    .join('\n\n')
  return `Previous exchange:\n${historyText}\n\nNew question: "${question}"\n\nProvide a natural, concise answer under 150 words.`
}

function buildReportPrompt(conversation) {
  return `Analyze this interview and return a JSON object with exactly this structure — no markdown, no extra text:
{
  "per_question_breakdown": [
    {
      "question": "exact question text",
      "suggested_answer": "the answer that was shown",
      "feedback": "1-2 sentences of constructive feedback on answer quality"
    }
  ],
  "overall_score": 7.5,
  "score_justification": "2-3 sentences explaining the score"
}

Interview transcript:
${conversation.map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`).join('\n\n')}`
}
