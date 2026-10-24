// Deterministic element recorder shared by the official extractor and the
// parity tests.  It records the same tree shape from either implementation.

const ELEMENT_NAMES = ['Box', 'Text', 'Button', 'Markdown', 'Code']

export function makeUI() {
  const ui = {}
  for (const name of ELEMENT_NAMES) {
    const element = (props) => {
      const { children, ...rest } = props ?? {}
      const out = { type: name, props: rest }
      if (children !== undefined) out.children = Array.isArray(children) ? children : [children]
      return out
    }
    element.__name = name
    ui[name] = element
  }
  return ui
}

export function installTreeRecorder(context) {
  // The official module's h() calls its function component with one props
  // object.  Call it too, so wrappers such as the desktop Button adapter are
  // reflected in the recorded tree exactly as a real renderer would apply them.
  context.h = (Component, props, ...children) => {
    const next = { ...(props ?? {}) }
    if (children.length === 1) next.children = children[0]
    else if (children.length > 1) next.children = children
    return Component(next)
  }
}

function cleanProps(props) {
  const out = {}
  for (const key of Object.keys(props ?? {}).sort()) {
    if (typeof props[key] !== 'function') out[key] = props[key]
  }
  return out
}

function flattenNodes(value, out) {
  if (Array.isArray(value)) {
    for (const item of value) flattenNodes(item, out)
    return
  }
  if (value === undefined || value === null) return
  if (typeof value !== 'object') {
    out.push(value)
    return
  }
  const children = []
  flattenNodes(value.children, children)
  out.push({ type: value.type, props: cleanProps(value.props), children })
}

export function normalizeTree(tree) {
  const out = []
  flattenNodes(tree, out)
  return out.length === 1 ? out[0] : out
}

export function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      if (typeof value[key] !== 'function') out[key] = normalizeValue(value[key])
    }
    return out
  }
  return value
}
