import { afterEach, describe, expect, mock, test } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'

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

const A = '/Users/someone/Projects/a'
const B = '/Users/someone/Projects/b'

afterEach(() => {
  cleanup()
  mounted.length = 0
  unmounted.length = 0
  tell.clear()
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
  test('the dead bar is drawn for the shown session only, and New shell replaces just that one', () => {
    const { container, rerender, getByText, queryByText } = render(
      <Shells theme="light" where="hosted" projectPath={A} />,
    )
    rerender(<Shells theme="light" where="hosted" projectPath={B} />)

    /* A dies while B is on screen: no bar, because the person is not looking
       at A. */
    act(() => tell.get(A)?.({ at: 'closed', why: 'the shell exited (0)' }))
    expect(queryByText('New shell')).toBeNull()

    /* Come back to A: the bar is there. */
    rerender(<Shells theme="light" where="hosted" projectPath={A} />)
    expect(getByText('the shell exited (0)')).toBeTruthy()

    act(() => {
      getByText('New shell').click()
    })
    /* A was remounted — a fresh shell in the same folder — and B was not. */
    expect(unmounted).toEqual([A])
    expect(mounted).toEqual([A, B, A])
    expect(onScreen(container).shown).toEqual([A])
  })

  test('a dead session the canvas moves away from is forgotten, so it holds nothing', () => {
    const { container, rerender } = render(<Shells theme="light" where="hosted" projectPath={A} />)
    act(() => tell.get(A)?.({ at: 'closed', why: 'the shell exited (0)' }))
    rerender(<Shells theme="light" where="hosted" projectPath={B} />)
    expect(onScreen(container).terminals).toEqual([B])
    expect(unmounted).toEqual([A])
  })
})
