import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { sendChat } from '../../api'

export default function AssistantChat({ doctorProfile }) {
  // Patient context (persisted locally; injected into LLM context invisibly)
  const [patient, setPatient] = useState(() => {
    try {
      const raw = localStorage.getItem('medai.patient.v1')
      if (raw) return JSON.parse(raw)
    } catch {}
    return { age: '', sex: '', weight: '', conditions: '', medications: '', allergies: '' }
  })
  const [showPatient, setShowPatient] = useState(false)

  const [messages, setMessages] = useState(() => {
    try {
      const raw = localStorage.getItem('medai.chat.v1')
      if (raw) return JSON.parse(raw)
    } catch {}
    return [
      { role: 'assistant', content: 'Bonjour, comment puis-je vous aider ?' },
    ]
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [started, setStarted] = useState(() => {
    return false
  })
  const chatInputRef = useRef(null)
  const messagesEndRef = useRef(null)

  // Persist messages to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('medai.chat.v1', JSON.stringify(messages))
    } catch {}
  }, [messages])

  // Persist patient context
  useEffect(() => {
    try { localStorage.setItem('medai.patient.v1', JSON.stringify(patient)) } catch {}
  }, [patient])

  // If we have more than the greeting, consider chat started
  useEffect(() => {
    if (messages.length > 1 && !started) setStarted(true)
  }, [messages, started])

  const exportMarkdown = () => {
    const lines = []
    lines.push(`# MedAI Chat Transcript`)
    lines.push(`_Exported: ${new Date().toISOString()}_`)
    lines.push('')
    messages.forEach((m) => {
      lines.push(m.role === 'user' ? '## You' : '## Assistant')
      lines.push('')
      lines.push(m.content || '')
      lines.push('')
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `medai-chat-${Date.now()}.md`
    document.body.appendChild(a)
    a.click()
    URL.revokeObjectURL(url)
    a.remove()
  }

  const clearChat = () => {
    const greeting = { role: 'assistant', content: 'Bonjour, comment puis-je vous aider ?' }
    setMessages([greeting])
    setStarted(false)
    setInput('')
    try { localStorage.removeItem('medai.chat.v1') } catch {}
    setTimeout(() => chatInputRef.current?.focus(), 0)
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    if (!started) setStarted(true)

    const userMsg = { role: 'user', content: input.trim() }
    // Prepare history to send (include the new user message)
    // If patient context exists, prepend a hidden context message.
    const hasPatient = Object.values(patient || {}).some((v) => (v || '').trim().length > 0)
    const patientMsg = hasPatient ? { role: 'user', content: formatPatientForContext(patient) } : null
    const hasDoctor = !!(doctorProfile && (doctorProfile.specialty || doctorProfile.name))
    const doctorMsg = hasDoctor ? { role: 'user', content: formatDoctorForContext(doctorProfile) } : null
    // Order: Doctor profile (if any) → Patient context (if any) → prior messages → new user message
    const prefix = [doctorMsg, patientMsg].filter(Boolean)
    const history = prefix.length ? [...prefix, ...messages, userMsg] : [...messages, userMsg]
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)
    // keep focus on the chat input when sending
    chatInputRef.current?.focus()
    try {
      const reply = await sendChat(history)
      const cleaned = stripLeadingGreeting(reply)
      setMessages((prev) => [...prev, { role: 'assistant', content: cleaned }])
    } catch (err) {
      console.error(err)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Désolé, une erreur est survenue.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  // Focus chat input after transitioning from landing to chat
  useEffect(() => {
    if (started) {
      chatInputRef.current?.focus()
    }
  }, [started])

  // Refocus after response completes
  useEffect(() => {
    if (!loading && started) {
      chatInputRef.current?.focus()
    }
  }, [loading, started])

  // Smooth scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  if (!started) {
    return (
      <div className="landing">
        <div className="landing-content fade-in">
          <h1 className="landing-title">Bonjour, comment puis-je vous aider ?</h1>
          <form className="landing-composer" onSubmit={onSubmit}>
            <input
              autoFocus
              type="text"
              placeholder="Posez votre question médicale…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" disabled={loading || !input.trim()}>
              {loading ? 'Envoi…' : 'Envoyer'}
            </button>
          </form>
          <div style={{ marginTop: 8 }}>
            {!showPatient ? (
              <button
                type="button"
                className="toolbar-btn"
                onClick={() => setShowPatient(true)}
                title="Ajouter un contexte patient"
              >
                Ajouter un contexte patient
              </button>
            ) : (
              <PatientPanel patient={patient} setPatient={setPatient} compact />
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chat fade-in">
      <div className="chat-toolbar">
        <button className="toolbar-btn" type="button" onClick={() => setShowPatient((s) => !s)} title="Contexte patient">
          {showPatient ? 'Masquer patient' : 'Contexte patient'}
        </button>
        <button className="toolbar-btn" type="button" onClick={exportMarkdown} title="Exporter en Markdown">
          Exporter
        </button>
        <button className="toolbar-btn danger" type="button" onClick={clearChat} title="Effacer la conversation">
          Nouveau chat
        </button>
      </div>
      {showPatient && (
        <PatientPanel patient={patient} setPatient={setPatient} />
      )}
      <div className="messages">
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            <div className="bubble bubble-appear">
              {m.role === 'assistant' ? (
                <AssistantMessage content={m.content} />
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
        {loading && (
          <div className="message assistant">
            <div className="bubble bubble-appear">
              <span className="typing" aria-label="Assistant is typing">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </span>
            </div>
          </div>
        )}
      </div>
      <form className="composer" onSubmit={onSubmit}>
        <input
          type="text"
          placeholder="Posez votre question médicale…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          ref={chatInputRef}
          autoFocus
        />
        <button type="submit" disabled={loading || !input.trim()}>
          {loading ? 'Envoi…' : 'Envoyer'}
        </button>
      </form>
    </div>
  )
}

function stripLeadingGreeting(text) {
  if (!text) return ''
  let t = String(text || '')
  // Remove BOM if present
  t = t.replace(/^\uFEFF/, '')
  const lines = t.split(/\r?\n/)
  const first = (lines[0] || '').trim()
  // Match greetings like "Bonjour Dr.", "Bonsoir Docteur", "Salut", with optional punctuation/space
  if (/^(bonjour|bonsoir|salut)\b/i.test(first)) {
    lines.shift()
    // Remove leading empty lines after greeting
    while (lines.length && lines[0].trim() === '') lines.shift()
    return lines.join('\n').trimStart()
  }
  return t
}

function AssistantMessage({ content }) {
  const normalized = normalizeMarkdown(content)
  const { answerBody, sourcesBody } = splitSources(normalized)
  const [openSources, setOpenSources] = React.useState(false)
  const SHOW_SOURCES = false // Temporarily disable Sources subsection

  return (
    <div className="assistant-message">
      <div className="section-body">
        <Markdown content={answerBody || normalized} />
      </div>
      {SHOW_SOURCES && (
        <div className="section group">
          <div className="section-header" onClick={() => setOpenSources((v) => !v)}>
            <span className="section-title">Sources</span>
            <span className="section-toggle">{openSources ? '▾' : '▸'}</span>
          </div>
          {openSources && (
            <div className="section-body">
              {sourcesBody ? <Markdown content={sourcesBody} /> : <div>Aucune source fournie.</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TriageBlock({ body }) {
  // Take the first non-empty line to derive badge
  const firstLine = (body || '').split(/\r?\n/).find((l) => l.trim().length > 0) || ''
  const level = inferUrgency(firstLine)
  return (
    <div>
      {level && <span className={`badge ${level}`}>{badgeLabel(level)}</span>}
      <Markdown content={body} />
    </div>
  )
}

function inferUrgency(line) {
  const l = line.toLowerCase()
  if (l.includes('urgence vitale')) return 'emergent'
  if (l.includes('urgent')) return 'urgent'
  if (l.includes('routine')) return 'routine'
  return ''
}

function badgeLabel(level) {
  if (level === 'emergent') return 'Urgence vitale'
  if (level === 'urgent') return 'Urgent (<48 h)'
  if (level === 'routine') return 'Routine'
  return ''
}

function Markdown({ content }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node, ...props }) => (
          <a target="_blank" rel="noopener noreferrer" {...props} />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function parseSections(text) {
  const lines = (text || '').split(/\r?\n/)
  const out = []
  let current = null
  for (const line of lines) {
    // Primary: Markdown heading ###
    let m = line.match(/^###\s+(.+)$/)
    if (m) {
      if (current) out.push(current)
      const title = sanitizeTitle(m[1])
      current = { title, body: '' }
      continue
    }
    // Fallback: bold-only line as section title
    m = line.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/)
    if (m) {
      if (current) out.push(current)
      const title = m[1].replace(/\s*[:：]\s*$/, '').trim()
      current = { title, body: '' }
      continue
    }
    // Fallback: plain line ending with colon
    m = line.match(/^\s*([^#>\-*`].*?)\s*[:：]\s*$/)
    if (m) {
      if (current) out.push(current)
      current = { title: m[1].trim(), body: '' }
      continue
    }
    if (current) {
      current.body += (current.body ? '\n' : '') + line
    }
  }
  if (current) out.push(current)
  return out
}

function splitSources(text) {
  // Prefer an explicit heading first
  const headingRe = /(\n|^)###\s+Sources\s*(?:\n|$)/i
  let m = text.match(headingRe)
  if (m) {
    const idx = m.index ?? 0
    const splitIdx = idx + m[0].length
    return {
      answerBody: text.slice(0, idx).trim(),
      sourcesBody: text.slice(splitIdx).trim(),
    }
  }
  // Fallback: detect a Sources/References title line (with optional list marker or bold)
  const lines = text.split(/\r?\n/)
  const isSourcesTitle = (ln) => {
    const clean = (ln || '')
      .replace(/^[\s>*-+•◦]+/, '')
      .replace(/^\s*(?:\*\*|__)?\s*(.*?)\s*(?:\*\*|__)?\s*$/s, '$1')
      .trim()
    return /^(sources?|références?)\s*[:：]?$/i.test(clean)
  }
  const isLinkLike = (ln) => {
    const s = (ln || '').trim()
    if (!s) return false
    // markdown link [text](url)
    if (/\[[^\]]+\]\((https?:\/\/|www\.)[^)]+\)/i.test(s)) return true
    // bare url or domain
    if (/(https?:\/\/|www\.|[a-z0-9-]+\.(?:org|com|fr|net|gov|edu|int|info|io|ai)\b)/i.test(s)) return true
    return false
  }
  const titleIdx = lines.findIndex(isSourcesTitle)
  if (titleIdx !== -1) {
    const before = lines.slice(0, titleIdx)
    const after = lines.slice(titleIdx + 1)
    const src = []
    const keep = []
    for (const ln of after) {
      if (isLinkLike(ln)) src.push(ln)
      else keep.push(ln)
    }
    return {
      answerBody: before.concat(keep).join('\n').trim(),
      sourcesBody: src.join('\n').trim(),
    }
  }
  return { answerBody: text, sourcesBody: '' }
}

function groupSections(sections) {
  const groups = []
  const push = (key, title, section) => {
    let g = groups.find((x) => x.key === key)
    if (!g) {
      g = { key, title, sections: [] }
      groups.push(g)
    }
    if (section) g.sections.push(section)
  }

  const canon = (s) => (s || '').toLowerCase()
  const isProcedure = (t) => /^(\d+\.|\d+\)|\*)\s*/.test(t) || /(varicoc[ée]l|embolisation|laparoscop)/i.test(t)
  const mapKey = (title) => {
    const t = canon(title)
    if (/sources?|r[ée]f[ée]rences?/.test(t)) return 'sources'
    if (/(clarification|question)/.test(t) || /triage/.test(t)) return 'clarification_triage'
    if (/r[ée]sum[ée]/.test(t)) return 'summary'
    if (/(crit[èe]re|diagnost|facteur|diff[ée]rentiel)/.test(t)) return 'diagnostic'
    if (/(alarme|red\s*flags?)/.test(t)) return 'red_flags'
    if (/(bilan|examen|imagerie|biolog|exploration)/.test(t)) return 'workup'
    if (/(option|th[ée]rapeut|proc[ée]dure)/.test(t) || isProcedure(title)) return 'therapeutic_options'
    if (/(prise en charge|plan|traitement|suivi|contr[ôo]le)/.test(t)) return 'management'
    if (/(conseil|document)/.test(t)) return 'counsel_doc'
    return 'other'
  }

  // First pass: assign sections to groups
  for (const s of sections) {
    const key = mapKey(s.title)
    push(key, groupTitleFor(key), s)
  }

  // Ensure Sources is last
  const sources = groups.filter((g) => g.key === 'sources')
  const rest = groups.filter((g) => g.key !== 'sources')
  return [...rest, ...sources]
}

function groupTitleFor(key) {
  switch (key) {
    case 'clarification_triage': return 'Clarification & Triage'
    case 'summary': return 'Résumé clinique'
    case 'diagnostic': return 'Diagnostic'
    case 'red_flags': return 'Signes d’alarme'
    case 'workup': return 'Bilan / Examens'
    case 'therapeutic_options': return 'Options thérapeutiques'
    case 'management': return 'Prise en charge & Suivi'
    case 'counsel_doc': return 'Conseil & Documentation'
    case 'sources': return 'Sources'
    default: return 'Autres'
  }
}

function sanitizeTitle(raw) {
  let t = (raw || '').trim()
  // Strip wrapping bold markers and trailing colon or arrows
  t = t.replace(/^\s*(?:\*\*|__)?\s*(.*?)\s*(?:\*\*|__)?\s*$/s, '$1')
  t = t.replace(/\s*[:：]+\s*$/u, '')
  t = t.replace(/[▾▸›»]+\s*$/u, '')
  return t.trim()
}

function normalizeMarkdown(text) {
  if (!text) return ''
  let t = text
  // 1) Convert bold-only headings like **Titre:** to ### Titre
  t = t.replace(/^\s*\*\*(.+?)\*\*\s*(?:[:：]?\s*(?:[▾▸›»]+)?)?\s*$/gm, (m, p1) => `### ${p1.trim()}`)
  // Also handle __Titre__
  t = t.replace(/^\s*__(.+?)__\s*(?:[:：]?\s*(?:[▾▸›»]+)?)?\s*$/gm, (m, p1) => `### ${p1.trim()}`)
  // 1b) Convert plain title lines ending with a colon into headings
  t = t.replace(/^(?!\s*(?:#|>|-|\*|```|\d+\.|\|))\s*(.+?)\s*[:：]\s*$/gm, (m, p1) => `### ${p1.trim()}`)
  // 1c) Ensure Sources/References have their own heading; preserve trailing inline links
  t = t.replace(/^\s*(sources?|références?)\s*[:：]?\s*(.*)$/gim, (m, _kw, rest) => {
    const tail = (rest || '').trim()
    return tail ? `### Sources\n${tail}` : '### Sources'
  })
  // 1d) Promote list-item Sources into heading as well; preserve trailing inline links
  t = t.replace(/^\s*[-*+•◦]\s*(sources?|références?)\s*[:：]?\s*(.*)$/gim, (m, _kw, rest) => {
    const tail = (rest || '').trim()
    return tail ? `### Sources\n${tail}` : '### Sources'
  })
  // 2) Replace leading bullets using • or ◦ with proper markdown '- '
  t = t.replace(/^\s*[•◦]\s+/gm, '- ')
  // 3) Split inline bullets: " • item1 • item2" -> new lines with '- '
  t = t.replace(/\s+[•◦]\s+/g, '\n- ')
  // 3b) Drop standalone dropdown arrows lines
  t = t.replace(/^\s*[▾▸›»]+\s*$/gm, '')
  // 4) Ensure blank line after headings
  t = t.replace(/^(###\s+.+)(?!\n\n)/gm, '$1\n')
  // 5) Linkify domains (www.* and bare domains) by adding https://
  t = t.replace(/(?<![\w/:])(www\.[^\s)]+)\/??/g, (m, host) => `https://${host}`)
  t = t.replace(/(?<![\w/:])((?:[a-z0-9-]+\.)+(?:org|com|fr|net|gov|edu|int|info|io|ai)(?:\/[\w\-./#?=&%+]*)?)/gi, (m, url) => {
    if (/^https?:\/\//i.test(url)) return url
    // Avoid converting markdown links and tables
    if (url.includes('|')) return url
    return `https://${url}`
  })
  // 5b) Fix duplicated scheme segments like https://academic.https://...
  t = t.replace(/https?:\/\/[^\s]*https?:\/\//gi, 'https://')
  // 6) Basic pipe-table helper: if multiple consecutive lines contain '|', insert separator after first
  t = addTableSeparators(t)
  // 6b) Bulletize plain lines under headings: turn consecutive non-empty, non-list lines into '- ' items
  t = bulletizePlainBlocks(t)
  // 6c) Insert horizontal rules between sections for readability
  t = addSectionSeparators(t)
  // 7) Trim excessive blank lines
  t = t.replace(/\n{3,}/g, '\n\n')
  return t
}

function addTableSeparators(text) {
  const lines = text.split(/\r?\n/)
  const out = []
  let i = 0
  while (i < lines.length) {
    out.push(lines[i])
    if (lines[i].includes('|')) {
      // Look ahead for a block of '|' lines
      const start = i
      let j = i + 1
      while (j < lines.length && lines[j].includes('|') && !/^\s*[-:|\s]+$/.test(lines[j])) j++
      const count = j - start
      if (count >= 2) {
        // Insert separator after header (start line) if next line is not already separator
        const cols = lines[start].split('|').length - 1
        const sep = Array.from({ length: cols }, () => '---').join(' | ')
        // Only insert if next line not a separator row
        if (!/^\s*[-:|\s]+$/.test(lines[start + 1])) {
          out.push(sep)
        }
      }
      // Push the rest of the block
      for (let k = i + 1; k < j; k++) out.push(lines[k])
      i = j
      continue
    }
    i++
  }
  return out.join('\n')
}

function addSectionSeparators(text) {
  const lines = text.split(/\r?\n/)
  const out = []
  let seenFirstHeading = false
  let inCode = false
  const isHr = (s) => /^\s*(?:---|\*\*\*|___)\s*$/.test(s)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^```/.test(line)) {
      inCode = !inCode
      out.push(line)
      continue
    }
    const isHeading = /^###\s+/.test(line)
    if (!inCode && isHeading) {
      if (seenFirstHeading) {
        const prev = out.length ? out[out.length - 1] : ''
        if (!isHr(prev)) {
          if (prev && prev.trim() !== '') out.push('')
          out.push('---')
          out.push('')
        }
      }
      seenFirstHeading = true
      out.push(line)
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

// reverted: promoteTitles helper (not needed)

function bulletizePlainBlocks(text) {
  const lines = text.split(/\r?\n/)
  const out = []
  let inBlock = false
  let blockStart = -1
  const isListLike = (s) => /^(\s*(-|\*|\+|\d+\.|>\s|\|)|\s*```)/.test(s) || s.trim() === '' || /^###\s+/.test(s)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const listy = isListLike(line)
    if (!listy && !inBlock) {
      inBlock = true
      blockStart = out.length
      out.push(line)
    } else if (!listy && inBlock) {
      out.push(line)
    } else {
      // We hit a boundary; flush previous block
      if (inBlock) {
        const blockLen = out.length - blockStart
        if (blockLen >= 2) {
          for (let k = blockStart; k < out.length; k++) {
            if (out[k].trim().length) out[k] = `- ${out[k].trim()}`
          }
        }
        inBlock = false
        blockStart = -1
      }
      out.push(line)
    }
  }
  // Flush at end
  if (inBlock) {
    const blockLen = out.length - blockStart
    if (blockLen >= 2) {
      for (let k = blockStart; k < out.length; k++) {
        if (out[k].trim().length) out[k] = `- ${out[k].trim()}`
      }
    }
  }
  return out.join('\n')
}

function formatPatientForContext(p) {
  const lines = ['Patient context:',
    p.age ? `- Age: ${p.age}` : '',
    p.sex ? `- Sex: ${p.sex}` : '',
    p.weight ? `- Weight: ${p.weight}` : '',
    p.conditions ? `- Conditions: ${p.conditions}` : '',
    p.medications ? `- Medications: ${p.medications}` : '',
    p.allergies ? `- Allergies: ${p.allergies}` : '',
  ].filter(Boolean)
  return lines.join('\n')
}

function formatDoctorForContext(d) {
  const lines = ['Contexte médecin:',
    d.name ? `- Nom: ${d.name}` : '',
    d.specialty ? `- Spécialité: ${d.specialty}` : '',
  ].filter(Boolean)
  return lines.join('\n')
}

function PatientPanel({ patient, setPatient, compact = false }) {
  const onChange = (k) => (e) => setPatient({ ...patient, [k]: e.target.value })
  const clear = () => setPatient({ age: '', sex: '', weight: '', conditions: '', medications: '', allergies: '' })
  return (
    <div className={`patient-panel ${compact ? 'compact' : ''}`}>
      <div className="patient-header">
        <div className="patient-title">Contexte patient</div>
        {!compact && (
          <button className="toolbar-btn" type="button" onClick={clear} title="Effacer le contexte patient">Effacer</button>
        )}
      </div>
      <div className="patient-grid">
        <label>
          <span>Âge</span>
          <input type="text" value={patient.age} onChange={onChange('age')} placeholder="ex: 54" />
        </label>
        <label>
          <span>Sexe</span>
          <input type="text" value={patient.sex} onChange={onChange('sex')} placeholder="H/F" />
        </label>
        <label>
          <span>Poids</span>
          <input type="text" value={patient.weight} onChange={onChange('weight')} placeholder="kg" />
        </label>
        <label className="wide">
          <span>Antécédents</span>
          <input type="text" value={patient.conditions} onChange={onChange('conditions')} placeholder="HTA, diabète…" />
        </label>
        <label className="wide">
          <span>Médications</span>
          <input type="text" value={patient.medications} onChange={onChange('medications')} placeholder="Liste des médicaments" />
        </label>
        <label className="wide">
          <span>Allergies</span>
          <input type="text" value={patient.allergies} onChange={onChange('allergies')} placeholder="Ex: pénicilline" />
        </label>
      </div>
      {compact && (
        <div className="patient-hint">Le contexte patient sera inclus dans l'analyse de l'IA.</div>
      )}
    </div>
  )
}
