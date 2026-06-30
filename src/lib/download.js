import JSZip from 'jszip'
import { jsPDF } from 'jspdf'
import { supabase } from './supabase'

export async function downloadSessionZip(session, report) {
  const zip = new JSZip()

  // 1. Audio recording
  if (session.audio_url) {
    try {
      const { data } = await supabase.storage
        .from('recordings')
        .createSignedUrl(session.audio_url, 300)

      if (data?.signedUrl) {
        const audioRes = await fetch(data.signedUrl)
        const audioBlob = await audioRes.blob()
        const ext = session.audio_url.split('.').pop() || 'webm'
        zip.file(`recording.${ext}`, audioBlob)
      }
    } catch {
      // skip audio if unavailable
    }
  }

  // 2. Transcript
  zip.file('transcript.txt', buildTranscriptText(session, report))

  // 3. Report PDF
  const pdfBlob = buildReportPDF(session, report)
  zip.file('report.pdf', pdfBlob)

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  const company = (session.company || 'Session').replace(/\s+/g, '_')
  const date = new Date(session.started_at).toISOString().split('T')[0]
  const filename = `InterviewOS_${company}_${date}.zip`

  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function buildTranscriptText(session, report) {
  const line = '='.repeat(50)
  const date = new Date(session.started_at).toLocaleString()
  const mode = session.mode === 'interview' ? 'Interview Mode' : 'Practice Mode'

  let text = `INTERVIEWOS SESSION TRANSCRIPT\n${line}\n\n`
  text += `Date:       ${date}\n`
  text += `Mode:       ${mode}\n`
  text += `Company:    ${session.company || 'N/A'}\n`
  text += `Job Title:  ${session.job_title || 'N/A'}\n`
  text += `Interviewer:${session.interviewer || 'N/A'}\n\n`
  text += `${line}\n\n`

  if (report?.full_transcript) {
    text += report.full_transcript
  }

  if (report?.overall_score) {
    text += `\n\n${line}\nOVERALL SCORE: ${report.overall_score}/10\n\n`
    text += report.score_justification || ''
  }

  return text
}

function buildReportPDF(session, report) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 20
  const CW = W - M * 2
  let y = 24

  const addPage = () => {
    doc.addPage()
    y = 20
  }

  const checkPage = (needed = 20) => {
    if (y + needed > 275) addPage()
  }

  // Header bar
  doc.setFillColor(26, 115, 232)
  doc.rect(0, 0, W, 14, 'F')
  doc.setFontSize(11)
  doc.setTextColor(255, 255, 255)
  doc.text('InterviewOS', M, 9.5)

  // Title
  doc.setFontSize(20)
  doc.setTextColor(26, 115, 232)
  doc.text('Session Report', M, y)
  y += 8

  // Session meta
  doc.setFontSize(10)
  doc.setTextColor(95, 99, 104)
  const meta = [
    new Date(session.started_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    session.company,
    session.job_title,
    session.mode === 'interview' ? 'Interview Mode' : 'Practice Mode',
  ].filter(Boolean).join('  ·  ')
  doc.text(meta, M, y)
  y += 10

  doc.setDrawColor(218, 220, 224)
  doc.line(M, y, W - M, y)
  y += 8

  // Score
  if (report?.overall_score != null) {
    doc.setFontSize(15)
    doc.setTextColor(26, 115, 232)
    doc.text(`Overall Score: ${report.overall_score} / 10`, M, y)
    y += 7

    if (report.score_justification) {
      doc.setFontSize(10)
      doc.setTextColor(32, 33, 36)
      const lines = doc.splitTextToSize(report.score_justification, CW)
      doc.text(lines, M, y)
      y += lines.length * 5 + 8
    }
  }

  // Per-question breakdown
  if (report?.per_question_breakdown?.length) {
    checkPage(16)
    doc.setFontSize(13)
    doc.setTextColor(26, 115, 232)
    doc.text('Question Breakdown', M, y)
    y += 8

    report.per_question_breakdown.forEach((item, idx) => {
      checkPage(30)

      doc.setFontSize(9)
      doc.setTextColor(154, 160, 166)
      doc.text(`QUESTION ${idx + 1}`, M, y)
      y += 5

      doc.setFontSize(10)
      doc.setTextColor(32, 33, 36)
      const qLines = doc.splitTextToSize(item.question || '', CW)
      checkPage(qLines.length * 5 + 4)
      doc.text(qLines, M, y)
      y += qLines.length * 5 + 3

      const answerText = item.suggested_answer || item.answer || ''
      if (answerText) {
        doc.setFontSize(9)
        doc.setTextColor(154, 160, 166)
        doc.text(session.mode === 'interview' ? 'SUGGESTED ANSWER' : 'YOUR ANSWER', M, y)
        y += 4
        doc.setFontSize(10)
        doc.setTextColor(32, 33, 36)
        const aLines = doc.splitTextToSize(answerText, CW)
        checkPage(aLines.length * 5 + 4)
        doc.text(aLines, M, y)
        y += aLines.length * 5 + 3
      }

      if (item.feedback) {
        doc.setFontSize(9)
        doc.setTextColor(154, 160, 166)
        doc.text('FEEDBACK', M, y)
        y += 4
        doc.setFontSize(10)
        doc.setTextColor(95, 99, 104)
        const fLines = doc.splitTextToSize(item.feedback, CW)
        checkPage(fLines.length * 5 + 8)
        doc.text(fLines, M, y)
        y += fLines.length * 5 + 4
      }

      doc.setDrawColor(218, 220, 224)
      doc.line(M, y, W - M, y)
      y += 7
    })
  }

  // Full transcript
  if (report?.full_transcript) {
    checkPage(20)
    doc.setFontSize(13)
    doc.setTextColor(26, 115, 232)
    doc.text('Full Transcript', M, y)
    y += 8

    doc.setFontSize(9)
    doc.setTextColor(32, 33, 36)
    const tLines = doc.splitTextToSize(report.full_transcript, CW)
    tLines.forEach((line) => {
      checkPage(6)
      doc.text(line, M, y)
      y += 5
    })
  }

  return doc.output('blob')
}
