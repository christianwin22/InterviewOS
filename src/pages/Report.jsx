import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { downloadSessionZip } from '../lib/download'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function Report() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [session, setSession] = useState(null)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [audioUrl, setAudioUrl] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [audioProgress, setAudioProgress] = useState(0)
  const [isDownloading, setIsDownloading] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)

  const audioRef = useRef(null)
  const progressRef = useRef(null)

  useEffect(() => {
    loadReport()
  }, [sessionId])

  async function loadReport() {
    const [{ data: sess }, { data: rep }] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', sessionId).single(),
      supabase.from('session_reports').select('*').eq('session_id', sessionId).single(),
    ])

    setSession(sess)
    setReport(rep)

    // Generate signed URL for audio
    if (sess?.audio_url) {
      const { data } = await supabase.storage
        .from('recordings')
        .createSignedUrl(sess.audio_url, 3600)
      if (data?.signedUrl) setAudioUrl(data.signedUrl)
    }

    setLoading(false)
  }

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
    } else {
      audio.play()
    }
    setIsPlaying(!isPlaying)
  }

  function handleTimeUpdate() {
    const audio = audioRef.current
    if (!audio || !audio.duration) return
    setAudioProgress(audio.currentTime / audio.duration)
  }

  function handleProgressClick(e) {
    const audio = audioRef.current
    if (!audio || !audio.duration) return
    const rect = progressRef.current.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    audio.currentTime = pct * audio.duration
    setAudioProgress(pct)
  }

  function handleAudioEnded() {
    setIsPlaying(false)
    setAudioProgress(0)
  }

  function formatAudioTime(secs) {
    if (!secs || isNaN(secs)) return '0:00'
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  async function handleDownload() {
    if (!session) return
    setIsDownloading(true)
    try {
      await downloadSessionZip(session, report)
    } catch (err) {
      alert('Download failed. Please try again.')
    }
    setIsDownloading(false)
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-screen"><div className="spinner" /></div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="page">
        <div className="container" style={{ padding: '32px 16px' }}>
          <p style={{ color: 'var(--text-muted)' }}>Report not found.</p>
          <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => navigate('/')}>Go home</button>
        </div>
      </div>
    )
  }

  const modeColor = session.mode === 'interview' ? 'var(--blue)' : 'var(--green)'
  const breakdown = report?.per_question_breakdown || []

  return (
    <div className="page">
      <div className="nav-bar">
        <button className="nav-back" onClick={() => navigate('/')}>← Home</button>
        <span className="nav-title">Report</span>
        <button
          onClick={handleDownload}
          disabled={isDownloading}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: 14, fontWeight: 500, padding: '8px 0' }}
        >
          {isDownloading ? '…' : '⬇ Download'}
        </button>
      </div>

      <div
        className="form-scroll"
        style={{ paddingBottom: 40 }}
      >
        <div className="container" style={{ paddingTop: 20 }}>

          {/* Session info header */}
          <div style={{ marginBottom: 20 }}>
            <span
              style={{
                fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em',
                color: modeColor, background: session.mode === 'interview' ? 'var(--blue-light)' : 'var(--green-light)',
                padding: '3px 10px', borderRadius: 20,
              }}
            >
              {session.mode === 'interview' ? 'Interview mode' : 'Practice mode'}
            </span>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 10, marginBottom: 4 }}>
              {session.company || 'Session'}{session.job_title ? ` — ${session.job_title}` : ''}
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>{formatDate(session.started_at)}</p>
          </div>

          {/* Score */}
          {report?.overall_score != null && (
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div className="score-circle" style={{ borderColor: modeColor }}>
                <span className="score-number" style={{ color: modeColor }}>
                  {Number(report.overall_score).toFixed(1)}
                </span>
                <span className="score-denom">/10</span>
              </div>
              {report.score_justification && (
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, padding: '0 8px' }}>
                  {report.score_justification}
                </p>
              )}
            </div>
          )}

          {/* Audio player */}
          {audioUrl && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Recording
              </div>
              <div className="audio-player">
                <button className="play-btn" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
                  {isPlaying ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  )}
                </button>

                <div
                  className="progress-track"
                  ref={progressRef}
                  onClick={handleProgressClick}
                >
                  <div className="progress-fill" style={{ width: `${audioProgress * 100}%` }} />
                </div>

                <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
                  {audioRef.current
                    ? `${formatAudioTime(audioRef.current.currentTime)} / ${formatAudioTime(audioRef.current.duration)}`
                    : '—'}
                </span>
              </div>
              <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleAudioEnded}
                style={{ display: 'none' }}
              />
            </div>
          )}

          {/* Download zip */}
          <button
            className="btn btn-outline"
            onClick={handleDownload}
            disabled={isDownloading}
            style={{ marginBottom: 24 }}
          >
            {isDownloading ? (
              <><div className="spinner" style={{ width: 16, height: 16 }} /> Preparing download…</>
            ) : (
              '⬇ Download ZIP (recording + transcript + report)'
            )}
          </button>

          {/* Per-question breakdown */}
          {breakdown.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Question breakdown
              </div>
              {breakdown.map((item, idx) => (
                <div key={idx} className="qa-item">
                  <div className="qa-label">Question {idx + 1}</div>
                  <div className="qa-text" style={{ marginBottom: 8 }}>{item.question}</div>

                  {(item.suggested_answer || item.answer) && (
                    <>
                      <div className="qa-label" style={{ marginTop: 8 }}>
                        {session.mode === 'interview' ? 'Suggested answer' : 'Your answer'}
                      </div>
                      <div className="qa-text" style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                        {item.suggested_answer || item.answer}
                      </div>
                    </>
                  )}

                  {item.feedback && (
                    <div className="qa-feedback">
                      💬 {item.feedback}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Full transcript toggle */}
          {report?.full_transcript && (
            <div>
              <button
                className="btn btn-ghost"
                onClick={() => setShowTranscript((s) => !s)}
                style={{ marginBottom: 12 }}
              >
                {showTranscript ? 'Hide full transcript' : 'Show full transcript'}
              </button>

              {showTranscript && (
                <div style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: 16,
                  fontSize: 14,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.7,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {report.full_transcript}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
