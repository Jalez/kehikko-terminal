import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModuleContext } from 'roadmap-module-protocol'

import { connect, type Host } from './wire/host.ts'
import { ChatList } from './view/chat-list.tsx'
import { TerminalView } from './view/terminal-view.tsx'
import type { Chat } from './chats-shape.ts'
import { Button } from '@/components/ui/button'

const ID = 'roadmap.terminal'

/**
 * A terminal, and the chats you can reopen in it.
 *
 * ## What the host is for here, which is almost nothing
 *
 * This module asks the host for nothing — `uses` is empty — and the context
 * carries exactly one fact it acts on: the theme. That is not an oversight. A
 * terminal is about a directory and a shell; the canvas switching epics has no
 * bearing on what you are typing, and a pane that restarted your shell because
 * somebody moved the subject in another pane would be unusable.
 *
 * The greeting is still answered, because a module that stays silent is a
 * module a host reports as broken.
 *
 * ## Why the shell survives a re-render but not a change of chat
 *
 * `TerminalView` is keyed by which shell it is. Picking a different chat gives
 * it a new key, which remounts it, which closes the old socket and its pty and
 * opens new ones. Everything else — the theme changing, the chat list
 * refreshing, the host saying anything at all — leaves the key alone and the
 * shell running. See the essay in `terminal-view.tsx` for why re-pointing a
 * live terminal is a question with no good answer.
 */

interface Open {
  /** A stable key. New on every open, so reopening the same chat is a new shell. */
  key: string
  cwd: string | null
  resume: string | null
  /** Which chat this shell was opened for, so its row can be marked. */
  chat: string | null
}

export function App() {
  const [context, setContext] = useState<ModuleContext | null>(null)
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Open | null>(null)
  const [listShown, setListShown] = useState(true)
  const host = useRef<Host | null>(null)
  const opened = useRef(0)

  useEffect(() => {
    const live = connect(ID, {
      onHello: (next) => setContext(next),
      onContext: (next) => setContext(next),
      /*
       * A walk, answered immediately and always with `found: false`.
       *
       * There is nothing in a terminal for a reference to land on — it holds a
       * shell, not a document with anchors. Answering at once rather than
       * staying silent is the whole point: the protocol says `goto` is the one
       * place a host WAITS on a module, and a host's reference index decides
       * between walking in place and falling back to a link by whether the walk
       * found anything. Silence would make every reference pointing here sit
       * out the host's timeout first.
       */
      onGoto: (_goto, answer) => {
        answer(false, 'A terminal holds a shell, not a document: there is nothing here to walk to.')
      },
    })
    host.current = live
    return () => {
      live.stop()
      host.current = null
    }
  }, [])

  /* The theme, applied to the document element rather than a wrapper, because
     the shadcn tokens are defined on `:root` and `.dark`. A class on a div
     would leave the page's own background, painted by `body`, in the other
     theme. With no host, no class is set and the media query in `index.css`
     decides — the honest default when nobody has said. */
  const theme = context?.theme ?? 'light'
  useEffect(() => {
    if (!context) return
    const root = document.documentElement
    root.classList.toggle('dark', context.theme === 'dark')
    root.classList.toggle('light', context.theme === 'light')
  }, [context])

  const reread = useCallback(async () => {
    try {
      const response = await fetch('/api/chats')
      const body = (await response.json()) as { chats?: Chat[] }
      setChats(Array.isArray(body.chats) ? body.chats : [])
    } catch {
      /* Its own server, unreachable from its own page — almost always the
         process restarting under a page left open. The list simply stays as it
         was rather than emptying, because an empty list is a claim about this
         machine and this is not evidence for it. */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reread()
  }, [reread])

  const choose = (chat: Chat) => {
    if (!chat.cwd) return
    opened.current += 1
    setOpen({ key: `chat-${chat.id}-${opened.current}`, cwd: chat.cwd, resume: chat.id, chat: chat.id })
  }

  const fresh = () => {
    opened.current += 1
    setOpen({ key: `fresh-${opened.current}`, cwd: null, resume: null, chat: null })
  }

  return (
    <div className="bg-background text-foreground flex h-dvh min-h-0 flex-col">
      {/*
        Below 34rem of PANE the list and the terminal cannot both be useful side
        by side — at 220px a split leaves two columns of nothing. So the list
        becomes a drawer over the terminal, toggled, and the terminal keeps the
        whole pane. A container query, not a viewport breakpoint: this page is
        sized by its pane and the window is irrelevant to it.
      */}
      <div className="flex items-center gap-2 border-b px-2 py-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs @min-[34rem]/pane:hidden"
          onClick={() => setListShown((shown) => !shown)}
          aria-expanded={listShown}
        >
          {listShown ? 'Hide chats' : 'Chats'}
        </Button>
        <span className="text-muted-foreground truncate font-mono text-[10px]">
          {open ? (open.cwd ?? '~') : 'no shell open'}
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div
          className={cnList(listShown)}
        >
          <ChatList
            chats={chats}
            chosen={open?.chat ?? null}
            onChoose={(chat) => {
              choose(chat)
              setListShown(false)
            }}
            onFresh={() => {
              fresh()
              setListShown(false)
            }}
            loading={loading}
          />
        </div>

        <div className="min-h-0 min-w-0 flex-1">
          {open ? (
            <TerminalView key={open.key} cwd={open.cwd} resume={open.resume} theme={theme} />
          ) : (
            <div className="grid h-full place-items-center p-4 text-center">
              <p className="text-muted-foreground max-w-sm text-xs">
                Pick a chat to reopen it, or start a new terminal. This is your own shell, on this machine, as
                you — the same as any terminal window.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The list's box, which is a column on a wide pane and a drawer on a narrow one.
 *
 * Written as a function rather than inline because the two states differ in
 * five classes and an inline ternary of that size is where a stray `hidden`
 * hides in review.
 */
function cnList(shown: boolean): string {
  const wide = 'shrink-0 border-r @min-[34rem]/pane:static @min-[34rem]/pane:block @min-[34rem]/pane:w-64'
  const drawer = shown
    ? 'absolute inset-y-0 left-0 z-10 w-56 bg-background border-r'
    : 'hidden'
  return `${drawer} ${wide}`
}
