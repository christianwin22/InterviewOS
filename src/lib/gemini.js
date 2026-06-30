export async function callGemini(systemPrompt, userPrompt) {
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt, userPrompt }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `Gemini API error: ${response.status}`)
  }

  const { text } = await response.json()
  return text
}
