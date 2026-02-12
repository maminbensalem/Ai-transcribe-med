const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

// Send full chat history for contextual replies
export async function sendChat(messages) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  if (!res.ok) throw new Error('Network error')
  const data = await res.json()
  return data.reply
}
