export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' })
  }

  const { systemPrompt, userPrompt } = req.body || {}
  if (!userPrompt) {
    return res.status(400).json({ error: 'userPrompt is required.' })
  }

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
      topP: 0.9,
    },
  }

  if (systemPrompt) {
    body.system_instruction = {
      parts: [{ text: systemPrompt }],
    }
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )

    const data = await geminiRes.json()

    if (!geminiRes.ok) {
      const msg = data?.error?.message || `Gemini API error: ${geminiRes.status}`
      return res.status(geminiRes.status).json({ error: msg })
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    return res.status(200).json({ text })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
