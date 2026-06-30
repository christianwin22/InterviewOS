import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { callGemini } from '../lib/gemini'
import { useAuth } from '../contexts/AuthContext'

const SILENCE_MS = 2500

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', '']
  return types.find((t) => !t || MediaRecorder.isTypeSupported(t)) || ''
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function PracticeMode() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [phase, setPhase] = useState('pacing') // pacing | preparing | speaking | listening | processing | complete
  const [pacing, setPacing] = useState('strict')
  const [currentQuestion, setCurrentQuestion] = useState('')
  const [liveTranscript, setLiveTranscript] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [questionsTotal, setQuestionsTotal] = useState(0)
  const [questionNum, setQuestionNum] = useState(0)

  const phaseRef = useRef('pacing')
  const ctxRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const recognitionRef = useRef(null)
  const silenceTimerRef = useRef(null)
  const timerRef = useRef(null)
  const sessionStartTimeRef = useRef(null)
  const conversationRef = useRef([]) // [{role: 'ai'|'user', text: string}]
  const questionIndexRef = useRef(0)
  const followUpUsedRef = useRef(false)
  const questionPlanRef = useRef([])
  const currentAnswerRef = useRef('')
  const endRequestedRef = useRef(false)

  useEffect(() => { phaseRef.current = phase }, [phase])

  useEffect(() => {
    const stored = sessionStorage.getItem('interviewContext')
    if (!stored) { navigate('/'); return }
    ctxRef.current = JSON.parse(stored)
  }, [navigate])

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current)
      clearTimeout(silenceTimerRef.current)
      window.speechSynthesis?.cancel()
      stopRecognitionFn()
      stopRecorderFn()
    }
  }, [])

  function stopRecorderFn() {
    const mr = mediaRecorderRef.current
    if (mr && mr.state !== 'inactive') {
      mr.stream?.getTracks().forEach((t) => t.stop())
      mr.stop()
    }
  }

  function stopRecognitionFn() {
    clearTimeout(silenceTimerRef.current)
    if (recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
    }
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  function speak(text, onEnd) {
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'en-US'
    utter.rate = 0.92
    utter.pitch = 1.0
    utter.onend = onEnd
    utter.onerror = () => onEnd?.()
    window.speechSynthesis.speak(utter)
  }

  async function startSession() {
    // Start recording
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    const mimeType = getSupportedMimeType()
    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {})
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data)
    }
    mr.start(1000)
    mediaRecorderRef.current = mr
    sessionStartTimeRef.current = new Date().toISOString()

    // Start timer
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)

    // Generate question plan
    setPhase('preparing')
    const ctx = ctxRef.current
    const planPrompt = buildQuestionPlanPrompt(ctx, pacing)
    let questions = []

    try {
      const planRaw = await callGemini(
        'You are an expert interviewer. Return only a valid JSON array of question strings — no markdown, no extra text.',
        planPrompt
      )
      questions = JSON.parse(planRaw.replace(/```json\n?|\n?```/g, '').trim())
      if (!Array.isArray(questions) || questions.length === 0) throw new Error('Invalid plan')
    } catch {
      showToast('Could not generate question plan. Using defaults.')
      questions = [
        'Tell me about yourself and your background.',
        'Why are you interested in this role?',
        'What is your greatest professional achievement?',
        'Describe a challenge you faced and how you overcame it.',
        'Where do you see yourself in 5 years?',
      ]
    }

    questionPlanRef.current = questions
    questionIndexRef.current = 0
    followUpUsedRef.current = false
    setQuestionsTotal(questions.length)
    setQuestionNum(1)

    askQuestion(questions[0])
  }

  const askQuestion = useCallback((questionText) => {
    if (endRequestedRef.current) return
    setCurrentQuestion(questionText)
    setPhase('speaking')
    conversationRef.current = [...conversationRef.current, { role: 'ai', text: questionText }]

    speak(questionText, () => {
      if (endRequestedRef.current) return
      startListening()
    })
  }, [])

  const startListening = useCallback(() => {
    if (endRequestedRef.current) return
    setPhase('listening')
    setLiveTranscript('')
    currentAnswerRef.current = ''

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      showToast('Speech recognition not supported.')
      return
    }

    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    let active = true

    recognition.onresult = (event) => {
      clearTimeout(silenceTimerRef.current)
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          currentAnswerRef.current += t + ' '
        } else {
          interim = t
        }
      }
      setLiveTranscript(currentAnswerRef.current.trimStart() + interim)

      // Reset silence timer
      silenceTimerRef.current = setTimeout(() => {
        active = false
        recognition.stop()
      }, SILENCE_MS)
    }

    recognition.onend = () => {
      if (active) {
        // Silence timeout fired — process answer
        handleUserAnswered()
      }
      // If !active, recognition was aborted (End button)
    }

    recognition.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      showToast(`Mic error: ${e.error}`)
    }

    recognition.start()

    // Also set a silence timer immediately in case no speech at all
    silenceTimerRef.current = setTimeout(() => {
      active = false
      recognition.stop()
    }, 30000) // 30s max wait before moving on

    recognitionRef.current = {
      stop: () => { active = false; clearTimeout(silenceTimerRef.current); recognition.stop() },
      abort: () => { active = false; clearTimeout(silenceTimerRef.current); recognition.abort() },
    }
  }, [])

  async function handleUserAnswered() {
    if (endRequestedRef.current) return
    const answer = currentAnswerRef.current.trim()
    setLiveTranscript('')

    if (answer) {
      conversationRef.current = [...conversationRef.current, { role: 'user', text: answer }]
    }

    setPhase('processing')

    const ctx = ctxRef.current
    const qIdx = questionIndexRef.current
    const followUpUsed = followUpUsedRef.current
    const plan = questionPlanRef.current

    // Ask Gemini: follow-up or next question?
    let nextAction = null
    try {
      const decisionRaw = await callGemini(
        buildDecisionSystemPrompt(ctx, plan, qIdx, followUpUsed),
        buildDecisionUserPrompt(conversationRef.current, answer, followUpUsed)
      )
      nextAction = JSON.parse(decisionRaw.replace(/```json\n?|\n?```/g, '').trim())
    } catch {
      nextAction = { action: 'next_question' }
    }

    if (endRequestedRef.current) return

    if (nextAction.action === 'follow_up' && !followUpUsed && nextAction.question) {
      followUpUsedRef.current = true
      askQuestion(nextAction.question)
    } else {
      const nextIdx = qIdx + 1
      questionIndexRef.current = nextIdx
      followUpUsedRef.current = false

      if (nextIdx >= plan.length) {
        // Done
        const closingRemark = 'Thank you so much for your time. That concludes our interview today. We\'ll be in touch soon.'
        setCurrentQuestion(closingRemark)
        setPhase('speaking')
        conversationRef.current = [...conversationRef.current, { role: 'ai', text: closingRemark }]
        speak(closingRemark, () => {
          if (!endRequestedRef.current) setPhase('complete')
        })
      } else {
        setQuestionNum(nextIdx + 1)
        askQuestion(plan[nextIdx])
      }
    }
  }

  async function handleEnd(fromCompleteScreen = false) {
    setShowEndConfirm(false)
    endRequestedRef.current = true
    window.speechSynthesis?.cancel()
    stopRecognitionFn()
    clearTimeout(silenceTimerRef.current)
    clearInterval(timerRef.current)
    setIsSaving(true)

    // Stop recorder
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

    const ctx = ctxRef.current
    const { data: session, error: sessionErr } = await supabase
      .from('sessions')
      .insert({
        user_id: user.id,
        mode: 'practice',
        company: ctx.company,
        job_title: ctx.jobTitle,
        interview_type: ctx.interviewType,
        interview_type_detail: ctx.interviewTypeDetail,
        interviewer: ctx.interviewer,
        expected_duration: ctx.expectedDuration,
        pacing_choice: pacing,
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
    let breakdown = []
    let score = null
    let justification = ''

    try {
      const reportRaw = await callGemini(
        'You are an expert interview coach. Return only valid JSON with no markdown.',
        buildPracticeReportPrompt(conversation, ctx)
      )
      const report = JSON.parse(reportRaw.replace(/```json\n?|\n?```/g, '').trim())
      breakdown = report.per_question_breakdown || []
      score = report.overall_score ?? null
      justification = report.score_justification || ''
    } catch { /* use empty */ }

    const fullTranscript = conversation
      .map((turn) => `${turn.role === 'ai' ? 'Interviewer' : 'You'}: ${turn.text}`)
      .join('\n\n')

    await supabase.from('session_reports').insert({
      session_id: session.id,
      full_transcript: fullTranscript,
      per_question_breakdown: breakdown,
      overall_score: score,
      score_justification: justification,
    })

    navigate(`/report/${session.id}`)
  }

  async function handleStart() {
    try {
      await startSession()
    } catch (err) {
      showToast('Microphone access denied. Please allow microphone access and try again.')
    }
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

  // Pacing selection screen
  if (phase === 'pacing') {
    return (
      <div className="page">
        <div className="nav-bar green">
          <button className="nav-back" style={{ color: 'rgba(255,255,255,0.9)' }} onClick={() => navigate(-1)}>
            ← Back
          </button>
          <span className="nav-title">Practice mode</span>
          <div style={{ width: 48 }} />
        </div>

        <div className="container" style={{ padding: '32px 16px' }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Choose your pacing</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 15, marginBottom: 24 }}>
            How should the session be managed?
          </p>

          <div
            className={`pacing-option ${pacing === 'strict' ? 'selected' : ''}`}
            onClick={() => setPacing('strict')}
          >
            <div className="pacing-radio" />
            <div>
              <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Strict time limit</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                AI fits all questions within your expected duration. Fewer questions, more focused.
              </div>
            </div>
          </div>

          <div
            className={`pacing-option ${pacing === 'all' ? 'selected' : ''}`}
            onClick={() => setPacing('all')}
          >
            <div className="pacing-radio" />
            <div>
              <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>All questions</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                AI asks everything it has planned — may go longer than expected duration.
              </div>
            </div>
          </div>

          <div className="info-box" style={{ marginTop: 8 }}>
            🎤 The AI will speak questions aloud. Make sure your volume is on.
          </div>

          <button className="btn btn-green" onClick={handleStart}>
            Start practice session
          </button>
        </div>
      </div>
    )
  }

  // Preparing screen
  if (phase === 'preparing') {
    return (
      <div className="page">
        <div className="nav-bar green">
          <span className="nav-title">Practice mode</span>
        </div>
        <div className="loading-screen">
          <div className="spinner" style={{ borderTopColor: 'var(--green)' }} />
          <p>Preparing your interview questions…</p>
        </div>
      </div>
    )
  }

  // Complete screen
  if (phase === 'complete') {
    return (
      <div className="page">
        <div className="nav-bar green">
          <span className="nav-title">Practice mode</span>
          <div className="elapsed-timer" style={{ color: 'white' }}>{formatTime(elapsed)}</div>
        </div>
        <div className="complete-screen">
          <div style={{ fontSize: 56, marginBottom: 20 }}>✅</div>
          <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Interview complete</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 16, marginBottom: 32, lineHeight: 1.6 }}>
            Great work! Your session has been recorded. View your report to see AI feedback on each answer.
          </p>
          <button className="btn btn-green" onClick={() => handleEnd(true)}>
            View report
          </button>
        </div>
      </div>
    )
  }

  // Active session (speaking | listening | processing)
  return (
    <div className="interview-page">
      <div className="nav-bar green">
        <div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Practice {questionsTotal > 0 ? `· Q${questionNum}/${questionsTotal}` : ''}
          </div>
          <div className="elapsed-timer">{formatTime(elapsed)}</div>
        </div>

        <div className="status-pill">
          {phase === 'listening' && <span className="pulse-dot" />}
          {phase === 'speaking' ? 'AI speaking' : phase === 'listening' ? 'Your answer' : 'Processing'}
        </div>

        <button className="nav-action" onClick={() => setShowEndConfirm(true)}>
          End
        </button>
      </div>

      {/* Question display */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {currentQuestion && (
          <div className="question-display green">
            {currentQuestion}
          </div>
        )}

        {phase === 'listening' && (
          <div style={{ padding: '0 16px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span className="pulse-dot" style={{ background: 'var(--green)' }} />
              <span style={{ fontSize: 14, color: 'var(--green)', fontWeight: 500 }}>Listening for your answer…</span>
            </div>
          </div>
        )}

        {phase === 'processing' && (
          <div style={{ padding: '0 16px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="spinner" style={{ width: 18, height: 18, borderTopColor: 'var(--green)' }} />
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Processing your answer…</span>
          </div>
        )}
      </div>

      {/* Live transcript */}
      <div className="transcript-bar">
        {liveTranscript || (phase === 'listening' ? 'Listening…' : ' ')}
      </div>

      <div className="bottom-controls">
        <button
          className="btn btn-danger"
          onClick={() => setShowEndConfirm(true)}
          style={{ borderRadius: 50 }}
        >
          End practice session
        </button>
      </div>

      {showEndConfirm && (
        <div className="modal-overlay" onClick={() => setShowEndConfirm(false)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle" />
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>End practice session?</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 15, marginBottom: 24 }}>
              Recording will stop and your report will be generated based on questions answered so far.
            </p>
            <button className="btn btn-danger" onClick={() => handleEnd(false)} style={{ marginBottom: 10 }}>
              End &amp; view report
            </button>
            <button className="btn btn-ghost" onClick={() => setShowEndConfirm(false)}>
              Continue session
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function buildQuestionPlanPrompt(ctx, pacing) {
  const durationNote = pacing === 'strict' && ctx.expectedDuration
    ? `The session must fit within ${ctx.expectedDuration}. Plan accordingly — fewer, more targeted questions.`
    : 'Plan a comprehensive set of interview questions covering all relevant areas.'

  return `Generate an interview question plan for this candidate and role.

${durationNote}

ROLE: ${ctx.jobTitle || 'Not specified'} at ${ctx.company || 'Not specified'}
INTERVIEW TYPE: ${ctx.interviewType || 'General'}${ctx.interviewTypeDetail ? ` — ${ctx.interviewTypeDetail}` : ''}
JOB DESCRIPTION: ${ctx.jobDescription || 'Not provided'}
REQUIREMENTS: ${ctx.requirements || 'Not provided'}
CANDIDATE NAME: ${ctx.name || 'Candidate'}
CANDIDATE BACKGROUND: ${ctx.personalBackground || ctx.cvText?.slice(0, 500) || 'Not provided'}

Return a JSON array of question strings only. 6-12 questions. No follow-up questions — those will be generated dynamically. No markdown.`
}

function buildDecisionSystemPrompt(ctx, plan, currentIdx, followUpUsed) {
  return `You are an expert interviewer conducting a practice interview for ${ctx.name || 'a candidate'} applying for ${ctx.jobTitle || 'a role'} at ${ctx.company || 'a company'}.

The planned questions are:
${plan.map((q, i) => `${i + 1}. ${q}`).join('\n')}

The candidate is currently on question ${currentIdx + 1}.
${followUpUsed ? 'A follow-up question has ALREADY been asked for this question. You MUST move to the next planned question.' : 'You may ask ONE follow-up question if the answer warrants deeper exploration, otherwise move to the next planned question.'}

CRITICAL RULE: Maximum ONE follow-up per planned question. Never ask a second follow-up on the same question.

Return JSON with exactly one of these structures:
{"action": "follow_up", "question": "your follow-up question here"}
{"action": "next_question"}

No markdown, no extra text.`
}

function buildDecisionUserPrompt(conversation, latestAnswer, followUpUsed) {
  const recent = conversation.slice(-6)
  const history = recent.map((t) => `${t.role === 'ai' ? 'Interviewer' : 'Candidate'}: ${t.text}`).join('\n\n')

  return `Recent conversation:
${history}

Candidate's latest answer: "${latestAnswer || '(no answer detected)'}"
${followUpUsed ? '\nIMPORTANT: Follow-up already used. You MUST return {"action": "next_question"}.' : ''}

Decide: ask a follow-up (only if answer needs significant clarification or expansion) OR move to next planned question.`
}

function buildPracticeReportPrompt(conversation, ctx) {
  const transcript = conversation
    .map((t) => `${t.role === 'ai' ? 'Interviewer' : 'Candidate'}: ${t.text}`)
    .join('\n\n')

  return `Analyze this practice interview and return JSON — no markdown, no extra text:
{
  "per_question_breakdown": [
    {
      "question": "the interviewer's question",
      "answer": "the candidate's answer",
      "feedback": "1-2 sentences of specific, constructive feedback"
    }
  ],
  "overall_score": 7.5,
  "score_justification": "2-3 sentences explaining the overall score and key takeaways"
}

Only include entries where the candidate gave an actual answer. Skip closing remarks and AI-only exchanges.

Full transcript:
${transcript}`
}
