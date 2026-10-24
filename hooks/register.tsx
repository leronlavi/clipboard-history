import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Clip } from '../types'

const PANE = 'clipboard'
const TITLE = 'Clipboard'
const STORE_KEY = 'clips'
const MAX_CLIPS = 50
const IMAGE_COLUMNS = 36

// Change the tag when a clip's fields change: it declines what an earlier
// version stored, which outlives a reload.
const clips = atom({ plugin: 'clipboard-history', key: 'clips' } as const, [], {
  shape: 'clips-2',
})

type Watched =
  | { kind: 'ready' }
  | { kind: 'skip'; reason: string }
  | { kind: 'text'; text: string }
  | { kind: 'image'; id: string; path: string; app?: string; width: string; height: string }

type ImageClip = Extract<Clip, { kind: 'image' }>

const NAMING_SYSTEM =
  'You name screenshots. Given the app that was in front and the text read from the picture, ' +
  'answer with a short name of 2 to 5 words saying what it shows (e.g. "Play Console app signing", ' +
  '"Stripe billing settings", "Gmail invoice thread"). Answer with the name alone: no quotes, no ' +
  'punctuation at the end.'

const cleanName = (text: string) =>
  (text.split('\n')[0] ?? '')
    .replace(/^["'`\s]+|["'`.\s]+$/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .slice(0, 60)

// A file name from a name: lowercase words joined by dashes (Hebrew kept).
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9֐-׿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)

const clock = (at: number) => {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const preview = (text: string, width: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > width ? flat.slice(0, Math.max(1, width - 1)) + '…' : flat
}

// Clips stored before images existed carry no kind: they are text.
const normalize = (kept: unknown): Clip[] =>
  Array.isArray(kept)
    ? kept.map(one => ({ kind: 'text', ...(one as object) }) as Clip)
    : []

const filesOf = (list: readonly Clip[]) =>
  list.flatMap(one => (one.kind === 'image' ? [one.path, one.thumb] : []))

// Module state starts over on a reload; the clips themselves live in $.state.
// Thumbnails read once, by clip id, as base64 PNG.
const thumbs = new Map<string, string>()
// A screenshot copied again from the pane comes back from the watcher.
let ignoreImagesUntil = 0

async function remove($: EngineInterface, files: readonly string[]) {
  if (files.length > 0) await $.process.run(['rm', '-f', ...files]).catch(() => undefined)
}

async function save($: EngineInterface, change: (list: Clip[]) => Clip[]) {
  let dropped: Clip[] = []
  const list = await update($, clips, before => {
    const after = change(before).slice(0, MAX_CLIPS)
    const kept = new Set(after.map(one => one.id))
    dropped = before.filter(one => !kept.has(one.id))
    return after
  })
  await $.store.set(STORE_KEY, list)
  for (const one of dropped) thumbs.delete(one.id)
  await remove($, filesOf(dropped))
}

async function add($: EngineInterface, seen: Watched) {
  if (seen.kind === 'text') {
    if (seen.text.trim() === '') return
    const clip: Clip = { id: `${Date.now()}`, kind: 'text', text: seen.text, at: Date.now() }
    await save($, list => [
      clip,
      ...list.filter(one => one.kind !== 'text' || one.text !== seen.text),
    ])
  } else if (seen.kind === 'image') {
    if (Date.now() < ignoreImagesUntil) return remove($, [seen.path])
    const thumb = seen.path.replace(/\.png$/, '.thumb.png')
    await $.process.run(['sips', '-Z', '480', seen.path, '--out', thumb]).catch(() => undefined)
    const clip: ImageClip = {
      id: seen.id,
      kind: 'image',
      path: seen.path,
      thumb,
      width: Number(seen.width),
      height: Number(seen.height),
      at: Date.now(),
    }
    await save($, list => [clip, ...list])
    // Naming takes a second or two; the watcher goes on meanwhile.
    void nameImage($, clip, seen.app ?? '').catch(() => undefined)
  }
}

// Reads the text in the picture, asks a small model for a name, and moves the
// files to that name so a pasted path says what it is.
async function nameImage($: EngineInterface, clip: ImageClip, app: string) {
  const script = `${$.plugin.root}/scripts/screenshot-text.js`
  const ocr = await $.process
    .run(['osascript', '-l', 'JavaScript', script, clip.path], { timeoutMs: 15000 })
    .catch(() => undefined)
  const seenText = ocr?.exitCode === 0 ? ocr.stdout.trim().slice(0, 2000) : ''

  let name = ''
  if (seenText !== '') {
    const answer = await $.model.complete({
      model: 'haiku',
      system: NAMING_SYSTEM,
      prompt: `App in front: ${app || 'unknown'}\nText read from the screenshot:\n${seenText}`,
      maxTokens: 30,
      timeoutMs: 20000,
    })
    if (answer.isAnswered) name = cleanName(answer.text)
  }
  if (name === '') name = app ? `${app} screenshot` : 'Screenshot'

  const stem = `${clip.path.replace(/\/[^/]+$/, '')}/${clip.id}-${slug(name) || 'screenshot'}`
  const moves = async (from: string, to: string) =>
    (await $.process.run(['mv', from, to]).catch(() => undefined))?.exitCode === 0
  const path = (await moves(clip.path, `${stem}.png`)) ? `${stem}.png` : clip.path
  const thumb = (await moves(clip.thumb, `${stem}.thumb.png`)) ? `${stem}.thumb.png` : clip.thumb
  const named: ImageClip = { ...clip, name, path, thumb }

  await save($, list => list.map(one => (one.id === clip.id ? named : one)))
  // Removed while it was being named: the moved files go too.
  if (!(await read($, clips)).some(one => one.id === clip.id)) await remove($, filesOf([named]))
}

// One watcher for the module's life: it ends with the module, and is
// started again if it dies on its own.
async function watch($: EngineInterface) {
  const home = (await $.process.run(['printenv', 'HOME'])).stdout.trim()
  const dir = `${home}/.claude/clipboard-history`
  const script = `${$.plugin.root}/scripts/clipboard-watch.js`
  for (let attempt = 0; attempt < 5; attempt++) {
    let buffered = ''
    const child = $.process.spawn({ argv: ['osascript', '-l', 'JavaScript', script, dir] })
    for await (const { text } of child) {
      buffered += text
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('{')) continue
        await add($, JSON.parse(line) as Watched).catch(() => undefined)
      }
    }
    await $.clock.sleep(5000)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'clipboard',
      description: 'Show your clipboard history (text and screenshots) in a pane on the right',
    })

    // Bring back the history kept from earlier sessions.
    const kept = normalize(await $.store.get(STORE_KEY))
    await update($, clips, list => (list.length > 0 ? list : kept))

    void watch($).catch(() => undefined)
    void $.ui.open({ id: PANE, title: TITLE, columns: 40 })

    return next(e)
  })

  on('command.run', { command: 'clipboard' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, columns: 40 })

    return { text: 'Clipboard pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // Pictures draw in the terminal alone; elsewhere the row's label stands.
    const Image = 'Image' in table ? table.Image : undefined
    const list = await read($, clips)
    const width = Math.max(10, (e.viewport?.columns ?? 40) - 14)
    let room = Math.max(1, (e.viewport?.rows ?? 24) - 3)

    const recopy = async (clip: Clip, surface: typeof e.surface) => {
      if (clip.kind === 'text') {
        await $.ui.copy({ text: clip.text, surface })
      } else {
        ignoreImagesUntil = Date.now() + 3000
        const set = `set the clipboard to (read (POSIX file "${clip.path}") as «class PNGf»)`
        const run = await $.process.run(['osascript', '-e', set]).catch(() => undefined)
        if (!run || run.exitCode !== 0) return $.ui.toast('That screenshot could not be copied')
      }
      await save($, list => [{ ...clip, at: Date.now() }, ...list.filter(one => one.id !== clip.id)])
      $.ui.toast(
        clip.kind === 'text'
          ? 'Copied: ⌘V pastes it anywhere, or ↵ puts it in the prompt'
          : 'Copied: press Ctrl+V in the prompt to attach the screenshot',
      )
    }

    // Text goes in at the cursor; a screenshot goes in as its file's path,
    // which Claude reads like any image file.
    const paste = async (clip: Clip) => {
      const text = clip.kind === 'text' ? clip.text : `${clip.path} `
      const filled = await $.prompt.fill({ text, mode: 'insert' })
      if (!filled.isFilled) $.ui.toast('The prompt is busy: press the entry to copy it instead')
    }

    const drop = (clip: Clip) => save($, list => list.filter(one => one.id !== clip.id))

    const rows = []
    for (const clip of list) {
      const imageRows =
        clip.kind === 'image'
          ? Math.min(10, Math.max(3, Math.round((IMAGE_COLUMNS * clip.height) / clip.width / 2)))
          : 0
      if (rows.length > 0 && room < 1 + imageRows) break
      room -= 1 + imageRows

      let source: string | undefined
      if (clip.kind === 'image') {
        source = thumbs.get(clip.id)
        if (source === undefined) {
          source = await $.fs
            .read(clip.thumb, { as: 'bytes' })
            .then(bytes => bytes.base64)
            .catch(() => '')
          thumbs.set(clip.id, source)
        }
      }
      const label =
        clip.kind === 'text'
          ? preview(clip.text, width)
          : `🖼 ${clip.name ?? `Screenshot ${clip.width}×${clip.height} (naming…)`}`

      rows.push(
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Button key={clip.id} plain onPress={press => recopy(clip, press.surface)}>
              <Text dimColor>{clock(clip.at)}</Text> {label}
            </Button>
            <Text> </Text>
            <Button key={`paste-${clip.id}`} plain dimColor onPress={() => paste(clip)}>
              ↵
            </Button>
            <Text> </Text>
            <Button key={`remove-${clip.id}`} plain dimColor onPress={() => drop(clip)}>
              ✕
            </Button>
          </Box>
          {clip.kind === 'image' && source && Image && (
            <Image
              source={{ png: source }}
              columns={Math.min(IMAGE_COLUMNS, width)}
              rows={imageRows}
              alt={clip.name ?? `Screenshot ${clip.width}×${clip.height}`}
            />
          )}
        </Box>,
      )
    }

    const clear = async () => {
      const files = filesOf(await read($, clips))
      thumbs.clear()
      await update($, clips, () => [])
      await $.store.set(STORE_KEY, [])
      await remove($, files)
    }

    return (
      <Box flexDirection="column">
        {list.length === 0 && (
          <Text dimColor>Nothing copied yet. Copy text or a screenshot and it shows up here.</Text>
        )}
        {rows}
        {list.length > 0 && (
          <Button key="clear" dimColor onPress={clear}>
            Clear all
          </Button>
        )}
      </Box>
    )
  })
}
