import { mock } from 'claude-code/testing'

export type Harness = ReturnType<typeof install>

export function install(
  on: any,
  options: {
    surfaces?: string[]
    env?: Record<string, string>
    enabledPlugins?: Record<string, boolean>
    fork?: (request: { prompt: string }) => any
    uiRender?: () => any
  } = {},
) {
  const saved = new Map<string, unknown>()
  const forks: { prompt: string }[] = []
  const fills: string[] = []
  const toasts: string[] = []
  const events: any[] = []
  const marks: any[] = []
  let promptText = ''
  const clock = mock.clock(on)

  on('store.get', (_$: unknown, e: { key: string }) => ({ value: saved.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 's1' }))
  on('session.surfaces', () => ({ value: options.surfaces ?? ['terminal'] }))
  on('session.version', () => ({ value: { base: '2.1.308', builtAt: '2026-10-01T00:00:00Z' } }))
  on('env.get', (_$: unknown, e: { name?: string; key?: string }) => ({
    value: (options.env ?? {})[e.name ?? e.key ?? ''],
  }))
  on('telemetry.log', (_$: unknown, e: any) => {
    events.push(e)
    return { value: undefined }
  })
  on('telemetry.mark', (_$: unknown, e: any) => {
    marks.push(e)
    return { value: undefined }
  })
  on('settings.read', () => ({
    value: { enabledPlugins: options.enabledPlugins ?? {} },
  }))
  on('prompt.read', () => ({ value: { text: promptText, cursor: promptText.length } }))
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    fills.push(e.text)
    promptText = e.text
    return { isFilled: true }
  })
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.toast', (_$: unknown, e: { text?: string }) => {
    toasts.push(e.text ?? '')
    return { value: undefined }
  })
  on('ui.render', options.uiRender ?? (() => ({ type: 'Text', props: {}, children: ['engine'] })))
  on('model.fork', (_$: unknown, e: { prompt: string }) => {
    forks.push(e)
    if (options.fork) return { value: options.fork(e) }
    return {
      value: {
        isAnswered: true,
        text: 'learn: A useful thing.\ntag: You should know\nexplain:\n**A useful thing**\nA short explanation.',
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    }
  })
  on('turn.step', async function* (_$: unknown, e: any) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: null,
    }
  })

  return {
    saved,
    forks,
    fills,
    toasts,
    events,
    marks,
    clock,
    get promptText() {
      return promptText
    },
    set promptText(value: string) {
      promptText = value
    },
  }
}

export async function settle(ms = 0) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function drain(stream: AsyncIterable<unknown>) {
  const iterator = stream[Symbol.asyncIterator]()
  let step = await iterator.next()
  while (!step.done) step = await iterator.next()
  return step.value
}

export async function trigger(
  $: any,
  harness: Harness,
  { index = 6, turnId = 't1', model = 'zhipu/glm-5.3[1m]', agentId = undefined as string | undefined } = {},
) {
  await drain(
    $.turn.step({
      turnId,
      index,
      model,
      messageCount: index + 1,
      ...(agentId !== undefined && { agentId }),
    }),
  )
  await settle(20)
}

export const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 24,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 24 },
  view: {},
}

export async function mountBand($: any, surface: 'terminal' | 'desktop' = 'terminal') {
  return $.ui.mount({
    plugin: 'sidelens',
    surface,
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })
}

export const OFFER = {
  isAnswered: true,
  text: 'learn: The build uses pnpm workspaces.\ntag: Heads up\nexplain:\n**Workspace build**\nUse pnpm from the repository root.',
  usage: {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
}
