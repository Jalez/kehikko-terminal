import { afterEach, describe, expect, mock, test } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'

import type { HeaderItemInput } from 'kehikot-module-protocol'

import type { Standing } from '../src/view/terminal-view.tsx'

/**
 * The component that keeps a shell per project, rendered with a stand-in for
 * the terminal.
 *
 * The real `TerminalView` builds an xterm emulator and opens a socket; neither
 * exists in `happy-dom` and neither is the thing under test. What matters here
 * is what the parent DOES to its children when the canvas speaks: which one
 * it mounts, which one it shows, and — the whole point — which ones it leaves
 * alone. So the stand-in records every mount and unmount by folder and draws
 * a div the tests can find, and the socket-and-pty half is verified by hand,
 * as the README says it must be.
 *
 * `mock.module` has to run before `app.tsx` is imported, which is why the
 * import of `Shells` is dynamic and below it.
 */

const mounted: string[] = []
const unmounted: string[] = []
const tell = new Map<string, (standing: Standing) => void>()

mock.module('../src/view/terminal-view.tsx', () => ({
  TerminalView: ({
    at,
    shown,
    onStanding,
  }: {
    at: string | null
    shown: boolean
    onStanding?: (standing: Standing) => void
  }) => {
    const name = at ?? 'home'
    useEffect(() => {
      mounted.push(name)
      return () => {
        unmounted.push(name)
      }
    }, [name])
    if (onStanding) tell.set(name, onStanding)
    return <div data-terminal={name} data-shown={shown ? 'yes' : 'no'} />
  },
}))

const { Shells } = await import('../src/app.tsx')

/* What the page declared to the host's header, whole each time, and where a press on it is taken. */
let declared: HeaderItemInput[][] = []
const presses: { current: ((press: { item: string; value?: string | boolean }) => string | boolean | void) | null } = { current: null }
const header = (items: HeaderItemInput[]) => {
  declared.push(items)
}
const press = (item: string) => {
  const out: { answer: unknown } = { answer: undefined }
  act(() => {
    out.answer = presses.current?.({ item })
  })
  return out.answer
}
const latest = () => declared.at(-1)?.find((one) => one.id === 'new-shell')
/** Shells as a host that draws the header frames it. */
const Hosted = (props: Partial<Parameters<typeof Shells>[0]> & { projectPath: string | null }) => (
  <Shells theme="light" where="hosted" header={header} presses={presses} drawn {...props} />
)

const A = '/Users/someone/Projects/a'
const B = '/Users/someone/Projects/b'

afterEach(() => {
  cleanup()
  mounted.length = 0
  unmounted.length = 0
  tell.clear()
  declared = []
  presses.current = null
})

/** What is on screen, by folder, and which of them is the shown one. */
function onScreen(container: HTMLElement) {
  const all = [...container.querySelectorAll<HTMLElement>('[data-terminal]')]
  return {
    terminals: all.map((el) => el.dataset.terminal),
    shown: all.filter((el) => el.dataset.shown === 'yes').map((el) => el.dataset.terminal),
    /* The wrapper's `hidden`, which is what actually keeps a session off the
       screen; the data attribute above is the stand-in's view of the same. */
    hidden: all.map((el) => (el.parentElement as HTMLElement).hidden),
  }
}

describe('a shell per project', () => {
  test('nothing is mounted while the page has not heard from the canvas', () => {
    const { container } = render(<Shells theme="light" where="listening" projectPath={null} />)
    expect(onScreen(container).terminals).toEqual([])
    expect(mounted).toEqual([])
  })

  test('unframed, one shell opens at home', () => {
    const { container } = render(<Shells theme="light" where="unhosted" projectPath={null} />)
    expect(onScreen(container)).toEqual({ terminals: ['home'], shown: ['home'], hidden: [false] })
  })

  test('two projects are two sessions, and switching shows one without unmounting the other', () => {
    const { container, rerender } = render(<Shells theme="light" where="hosted" projectPath={A} />)
    expect(onScreen(container)).toEqual({ terminals: [A], shown: [A], hidden: [false] })

    rerender(<Shells theme="light" where="hosted" projectPath={B} />)
    expect(onScreen(container)).toEqual({ terminals: [A, B], shown: [B], hidden: [true, false] })

    /* The thing the report is about, stated as a mount count: the first shell
       was mounted once and has not been unmounted, so its socket — and the
       command running behind it — was never touched by the switch. */
    expect(mounted).toEqual([A, B])
    expect(unmounted).toEqual([])
  })

  test('a server that stopped is said under the shell, and the shell’s last screen stays', () => {
    const { container, rerender } = render(<Shells theme="light" where="hosted" projectPath={A} />)
    rerender(<Shells theme="light" where="hosted" projectPath={A} cover="down" />)

    /* The module's own server stopped answering. The session is still mounted
       and still on screen — what a command printed before it died is the thing
       somebody wants to read — and the words are in the strip below it. */
    expect(container.querySelector('[data-cover]')?.getAttribute('data-cover')).toBe('down')
    expect(container.textContent).toContain('Terminal’s own server is not answering.')
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Try again'])
    expect(onScreen(container)).toEqual({ terminals: [A], shown: [A], hidden: [false] })
    expect(unmounted).toEqual([])

    /* A dead shell under a dead server offers the one thing that could work: not a new shell. */
    act(() => tell.get(A)?.({ at: 'closed', why: 'the connection ended' }))
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Try again'])

    rerender(<Shells theme="light" where="hosted" projectPath={A} />)
    expect(container.querySelector('[data-cover]')).toBeNull()
    /* The page has no button of its own for it: New shell is the header's. This host has pressed nothing, so the
       one control a page keeps for a host that draws no header is all there is. */
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['⋯'])
    expect(mounted).toEqual([A])
  })

  test('while nothing has been heard yet, the page says what it is waiting for', () => {
    const { container } = render(<Shells theme="light" where="listening" projectPath={null} cover="waiting" />)
    expect(container.textContent).toContain('Waiting for Kehikot…')
    expect(mounted).toEqual([])
  })

  test('coming back shows the same session rather than a new one', () => {
    const { container, rerender } = render(<Shells theme="light" where="hosted" projectPath={A} />)
    rerender(<Shells theme="light" where="hosted" projectPath={B} />)
    rerender(<Shells theme="light" where="hosted" projectPath={A} />)
    expect(onScreen(container)).toEqual({ terminals: [A, B], shown: [A], hidden: [false, true] })
    expect(mounted).toEqual([A, B])
    expect(unmounted).toEqual([])
  })

  test('a new session is told its own project folder, which is where it opens', () => {
    const { container, rerender } = render(<Shells theme="light" where="hosted" projectPath={A} />)
    rerender(<Shells theme="light" where="hosted" projectPath={B} />)
    /* Each stand-in was rendered with `at` equal to its folder — the attribute
       is that prop, verbatim — and `TerminalView` sends `at` as `cwd` in the
       opening frame, which `openable` in shell.ts spawns into. */
    expect(onScreen(container).terminals).toEqual([A, B])
  })
})

describe('an epic is not a key', () => {
  test('the same project under another epic is the same shell, untouched', () => {
    /* `Shells` takes no epic at all: the prop does not exist, so a parent
       cannot pass one and a switch of epic inside one project reaches this
       component as no change. The test renders the same project twice, which
       is exactly what an epic switch looks like from here. */
    const { container, rerender } = render(<Shells theme="light" where="hosted" projectPath={A} />)
    rerender(<Shells theme="light" where="hosted" projectPath={A} />)
    rerender(<Shells theme="dark" where="hosted" projectPath={A} />)
    expect(onScreen(container)).toEqual({ terminals: [A], shown: [A], hidden: [false] })
    expect(mounted).toEqual([A])
    expect(unmounted).toEqual([])
  })
})

describe('when a shell dies', () => {
  test('New shell is the header’s Run item: disabled while the shell runs, failed and pressable once it has ended, and it replaces just that session', () => {
    const { container, rerender } = render(<Hosted projectPath={A} />)
    expect(latest()).toMatchObject({ kind: 'run', label: 'New shell', state: 'idle', disabled: 'The shell here is still running.' })
    expect(String(press('new-shell'))).toContain('still running')
    expect(unmounted).toEqual([])

    rerender(<Hosted projectPath={B} />)
    /* A dies while B is on screen: it is not the shell the header speaks for. */
    act(() => tell.get(A)?.({ at: 'closed', why: 'the shell exited (0)' }))
    expect(latest()).toMatchObject({ state: 'idle' })

    /* Come back to A: the item says it ended, and why, and can be pressed. */
    rerender(<Hosted projectPath={A} />)
    expect(latest()).toMatchObject({ state: 'failed', result: 'the shell exited (0)', disabled: null })
    expect(container.textContent).not.toContain('the shell exited')
    expect(press('new-shell')).toBe(true)
    /* A was remounted — a fresh shell in the same folder — and B was not. */
    expect(unmounted).toEqual([A])
    expect(mounted).toEqual([A, B, A])
    expect(onScreen(container).shown).toEqual([A])
  })

  test('an item it has not got is not taken', () => {
    render(<Hosted projectPath={A} />)
    expect(String(press('nothing'))).toContain('not something a terminal has')
  })

  test('typing declares nothing: a shell that is running says the same thing for as long as it runs', () => {
    render(<Hosted projectPath={A} />)
    const count = declared.length
    expect(count).toBeGreaterThan(0)
    act(() => tell.get(A)?.({ at: 'live' }))
    act(() => tell.get(A)?.({ at: 'live' }))
    expect(declared.length).toBe(count)
  })

  test('no header is declared before there is a shell, and it is taken away with the page', () => {
    const { unmount } = render(<Hosted projectPath={null} where="listening" />)
    expect(declared.at(-1) ?? []).toEqual([])
    unmount()
  })

  test('on a page no host draws for, a dead shell has the page’s own control, and a live one has none', () => {
    const { container } = render(<Shells theme="light" where="unhosted" projectPath={A} header={header} presses={presses} />)
    expect(container.querySelector('[data-header-fallback]')).toBeNull()
    act(() => tell.get(A)?.({ at: 'closed', why: 'the shell exited (0)' }))
    expect(container.querySelector('[data-header-fallback]')).not.toBeNull()
  })

  test('a dead session the canvas moves away from is forgotten, so it holds nothing', () => {
    const { container, rerender } = render(<Shells theme="light" where="hosted" projectPath={A} />)
    act(() => tell.get(A)?.({ at: 'closed', why: 'the shell exited (0)' }))
    rerender(<Shells theme="light" where="hosted" projectPath={B} />)
    expect(onScreen(container).terminals).toEqual([B])
    expect(unmounted).toEqual([A])
  })
})

describe('a project folder renamed while its shell runs', () => {
  const ID = '6f1c2a9e-0b4d-4c55-9a51-2f7e1d3c8b10'
  const OTHER = 'a0b1c2d3-e4f5-4a6b-8c7d-9e0f1a2b3c4d'
  const RENAMED = '/Users/someone/Projects/a-renamed'
  const line = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-renamed]')

  test('the same id at a new folder keeps the running shell on screen and says so in one dismissable line', () => {
    const { container, rerender } = render(<Hosted projectPath={A} projectId={ID} />)
    act(() => tell.get(A)?.({ at: 'live' }))
    expect(line(container)).toBeNull()

    rerender(<Hosted projectPath={RENAMED} projectId={ID} />)
    /* Nothing unmounted, nothing new mounted: the same shell, opened in A, still on screen. */
    expect(unmounted).toEqual([])
    expect(mounted).toEqual([A])
    expect(onScreen(container)).toEqual({ terminals: [A], shown: [A], hidden: [false] })
    expect(line(container)?.textContent).toContain(
      `This folder was renamed to ${RENAMED}. The shell still works in it but shows the old name; open a new shell to start fresh.`,
    )

    /* New shell is offered while it runs, asked first, and never pressed for the person. */
    expect(latest()).toMatchObject({ state: 'idle', disabled: null, confirm: true })

    const dismiss = [...line(container)!.querySelectorAll('button')].find((b) => b.textContent === 'Dismiss')!
    act(() => dismiss.click())
    expect(line(container)).toBeNull()
    expect(unmounted).toEqual([])
  })

  test('New shell after a rename opens the next shell in the new folder', () => {
    const { container, rerender } = render(<Hosted projectPath={A} projectId={ID} />)
    rerender(<Hosted projectPath={RENAMED} projectId={ID} />)
    expect(press('new-shell')).toBe(true)
    expect(unmounted).toEqual([A])
    expect(mounted).toEqual([A, RENAMED])
    expect(onScreen(container).shown).toEqual([RENAMED])
    expect(line(container)).toBeNull()
    expect(latest()).toMatchObject({ disabled: 'The shell here is still running.', confirm: false })
  })

  test('a different id is a project switch: a separate shell, and no line', () => {
    const { container, rerender } = render(<Hosted projectPath={A} projectId={ID} />)
    rerender(<Hosted projectPath={B} projectId={OTHER} />)
    expect(onScreen(container)).toEqual({ terminals: [A, B], shown: [B], hidden: [true, false] })
    expect(line(container)).toBeNull()
    rerender(<Hosted projectPath={A} projectId={ID} />)
    expect(onScreen(container).shown).toEqual([A])
    expect(unmounted).toEqual([])
  })
})
