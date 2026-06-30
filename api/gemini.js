module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' })
  }

  const { systemPrompt, userPrompt } = req.body || {}
  if (!userPrompt) {
    return res.status(400).json({ error: 'userPrompt is required.' })
  }

  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: userPrompt }],
  }

  if (systemPrompt) {
    body.system = systemPrompt
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })

    const data = await response.json()

    if (!response.ok) {
      const msg = data && data.error && data.error.message
        ? data.error.message
        : 'Anthropic API error: ' + response.status
      return res.status(response.status).json({ error: msg })
    }

    const text =
      data &&
      data.content &&
      data.content[0] &&
      data.content[0].text
        ? data.content[0].text
        : ''

    return res.status(200).json({ text })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
