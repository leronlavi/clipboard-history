import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'clipboard-history',
  component: 'Pane',
  requestId: 'clipboard',
  props: {
    title: 'Clipboard',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

// Stands for the machine: the watcher prints `lines`, every command succeeds.
const machine = (on: On, lines: readonly object[], seenText = '') => {
  const ran: string[][] = []
  on('command.register', () => ({ value: { command: 'clipboard' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const stdout =
      e.argv[0] === 'printenv'
        ? '/Users/test\n'
        : String(e.argv[3]).endsWith('screenshot-text.js')
          ? seenText
          : ''
    return {
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('process.spawn', async function* () {
    // JXA's console.log writes to stderr; a line may arrive in pieces.
    if (lines.length > 0) {
      const text = lines.map(one => JSON.stringify(one)).join('\n') + '\n'
      yield { stream: 'stderr' as const, text: text.slice(0, 10) }
      yield { stream: 'stderr' as const, text: text.slice(10) }
    }
    return { value: { code: 0, signal: null } }
  })
  on('fs.read', () => ({ value: { base64: PNG } }))
  return ran
}

const DIR = '/Users/test/.claude/clipboard-history'

const SHOT = {
  kind: 'image',
  id: '42',
  path: `${DIR}/42.png`,
  width: '3000',
  height: '1796',
}

test('text and a screenshot show up, on every surface', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  machine(on, [
    { kind: 'ready' },
    { kind: 'text', text: 'hello from the clipboard' },
    SHOT,
    { kind: 'text', text: 'hello from the clipboard' },
  ])

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', text: /hello from the clipboard/ })).toBeTruthy()
    expect((await ui.find({ type: 'Button', text: /🖼/ }))?.text).toMatch(/🖼 Screenshot$/)
    // The same text twice is one entry.
    expect((await ui.findAll({ type: 'Button', text: /hello from/ })).length).toBe(1)
    await ui.unmount()
  }
})

test('✕ removes one entry and deletes its screenshot files', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const ran = machine(on, [{ kind: 'text', text: 'keep me' }, SHOT])

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'remove-42' })
  expect(await ui.find({ type: 'Button', text: /Screenshot/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /keep me/ })).toBeTruthy()
  expect(ran).toContainEqual(['rm', '-f', `${DIR}/42-screenshot.png`, `${DIR}/42-screenshot.thumb.png`])
  await ui.unmount()
})

test('↵ puts text at the cursor and a screenshot as its path', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  machine(on, [{ kind: 'text', text: 'paste me' }, SHOT])
  const filled: string[] = []
  on('prompt.fill', (_, e) => {
    filled.push(`${e.mode}:${e.text}`)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const row = await ui.find({ type: 'Button', text: /paste me/ })
  await ui.press({ key: `paste-${row?.key}` })
  await ui.press({ key: 'paste-42' })
  expect(filled).toEqual(['insert:paste me', `insert:${DIR}/42-screenshot.png `])
  await ui.unmount()
})

test('a screenshot is named from its app and its text, files and all', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const ran = machine(on, [{ ...SHOT, app: 'Google Chrome' }], 'Google Play Console\nApp signing\nUpload key')
  const asked: string[] = []
  on('model.complete', (_, e) => {
    asked.push(e.prompt)
    const usage = {
      input_tokens: 40,
      output_tokens: 6,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    return { value: { isAnswered: true, text: '"Play Console app signing."\n', usage } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  expect(asked[0]).toContain('App in front: Google Chrome')
  expect(asked[0]).toContain('App signing')
  expect(ran).toContainEqual(['mv', SHOT.path, `${DIR}/42-play-console-app-signing.png`])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', text: /🖼/ }))?.text).toMatch(/🖼 Play Console app signing$/)
  await ui.unmount()
})

test('a screenshot with no text is named after its app', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  machine(on, [{ ...SHOT, app: 'Preview' }])

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', text: /🖼/ }))?.text).toMatch(/🖼 Preview screenshot$/)
  await ui.unmount()
})

test('what a password manager marks concealed is never listed', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  machine(on, [{ kind: 'skip', reason: 'concealed' }])

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toMatch(/Nothing copied yet/)
  await ui.unmount()
})

test('history kept before screenshots existed still shows as text', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, { clips: [{ id: '1', text: 'from version one', at: 1 }] })
  machine(on, [])

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', text: /from version one/ })).toBeTruthy()
  await ui.unmount()
})
