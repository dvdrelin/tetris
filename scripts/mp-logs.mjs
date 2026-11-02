#!/usr/bin/env node
/**
 * mp:logs — pull MP match logs off a running server into ./mp-logs/ so they can be analysed
 * locally (and fed to `npm run mp:replay`).
 *
 *   npm run mp:logs -- --list
 *   npm run mp:logs -- --get 2026-11-02-AB12-1793575893710.jsonl
 *   npm run mp:logs -- --replay 2026-11-02-AB12-1793575893710.jsonl   # bundle → mp-logs/*.replay.json
 *   npm run mp:logs -- --tail                    # newest match, downloaded and replayed in one go
 *
 * Options: --host (default ntetris.ddns.net), --token (or env MP_ADMIN_TOKEN), --out (default mp-logs).
 * The token is never printed. Overridden base URL: --base https://example/api/mp.
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const args = process.argv.slice(2)
const flags = new Map()
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2)
    const next = args[i + 1]
    if (!next || next.startsWith('--')) flags.set(key, true)
    else { flags.set(key, next); i++ }
  }
}

const host = flags.get('host') || 'ntetris.ddns.net'
const base = flags.get('base') || `https://${host}/api/mp`
const token = process.env.MP_ADMIN_TOKEN || flags.get('token') || ''
const outDir = flags.get('out') || 'mp-logs'

if (!token) {
  console.error('no token: pass --token <MP_ADMIN_TOKEN> or set the MP_ADMIN_TOKEN environment variable')
  process.exit(2)
}

async function api(path) {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`GET ${path} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return text
}

async function main() {
  mkdirSync(outDir, { recursive: true })

  if (flags.get('list') || (!flags.get('get') && !flags.get('replay') && !flags.get('tail'))) {
    const body = JSON.parse(await api('/matches'))
    console.log(`directory on the server: ${body.directory}`)
    for (const m of body.matches) {
      const verdict = m.verdict ? `${m.verdict.reason}${m.verdict.detail ? `/${m.verdict.detail}` : ''}` : 'running'
      const names = m.players.map((p) => p.name).join(', ')
      console.log(
        `${m.startedAtIso}  ${m.code}  seed ${m.seed}  events ${String(m.events).padStart(5)}  ${String(m.bytes).padStart(7)}B  ${verdict.padEnd(22)} ${names}`,
      )
      console.log(`      ${m.file}`)
    }
    if (!body.matches.length) console.log('(no matches recorded yet — MP_LOGS is on, so play one and look again)')
    return
  }

  const pickNewest = async () => {
    const body = JSON.parse(await api('/matches'))
    if (!body.matches.length) throw new Error('no matches recorded')
    return body.matches[0].file
  }

  const file = flags.get('tail') ? await pickNewest() : flags.get('get') || flags.get('replay')
  if (flags.get('get') || flags.get('tail')) {
    const text = await api(`/matches/${encodeURIComponent(file)}`)
    const path = join(outDir, file)
    writeFileSync(path, text)
    console.log(`saved ${path} (${text.split('\n').filter(Boolean).length} events)`)
    console.log(`analyse: npm run mp:replay -- ${path}`)
  }
  if (flags.get('replay') || flags.get('tail')) {
    const text = await api(`/matches/${encodeURIComponent(file)}/replay`)
    const path = join(outDir, `${file.replace(/\.jsonl$/, '')}.replay.json`)
    writeFileSync(path, text)
    console.log(`saved ${path}`)
    console.log(`replay:  npm run mp:replay -- ${path} --heights`)
  }
}

main().catch((err) => {
  console.error(String(err.message || err))
  process.exit(1)
})
