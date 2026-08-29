import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Chat } from '../chats-shape.ts'

/**
 * Every chat on this machine, newest first, and the one press that reopens one.
 *
 * ## What a row is, and what it is not
 *
 * It is not a preview of the conversation. Rendering the transcript here would
 * be the transcript viewer this module was explicitly built NOT to be — the
 * user's words were "I didn't like how the app used to do it in terms of what I
 * saw and how I could interact with it", and a nicer read-only rendering is
 * still read-only. A row exists to be recognised and pressed.
 *
 * So a row carries the least that makes it recognisable: when it was last
 * touched, which directory it was held in, and the first thing the person
 * said. Everything else is in the chat, and the way to see the chat is to open
 * it.
 */

export function ChatList({
  chats,
  chosen,
  onChoose,
  onFresh,
  loading,
}: {
  chats: Chat[]
  /** The session id currently open, so its row can say so. */
  chosen: string | null
  onChoose: (chat: Chat) => void
  onFresh: () => void
  loading: boolean
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-xs font-semibold">Chats</h2>
        <Button size="sm" variant="outline" onClick={onFresh} className="h-7 text-xs">
          New terminal
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && <p className="text-muted-foreground p-3 text-xs">Reading ~/.claude/projects…</p>}

        {!loading && chats.length === 0 && (
          /* Not an error, and not an empty box either. A machine that has never
             run Claude Code looks exactly like this, and so does one whose home
             directory this process cannot read — say which is being looked at
             so the difference is somebody's to notice. */
          <p className="text-muted-foreground p-3 text-xs">
            No chats under <code className="font-mono">~/.claude/projects</code>. A new terminal still opens.
          </p>
        )}

        <ul>
          {chats.map((chat) => {
            const here = chat.id === chosen
            return (
              <li key={chat.id}>
                <button
                  type="button"
                  onClick={() => onChoose(chat)}
                  className={cn(
                    'hover:bg-accent/60 w-full cursor-pointer border-b px-3 py-2 text-left',
                    here && 'bg-accent',
                  )}
                  aria-current={here ? 'true' : undefined}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-muted-foreground min-w-0 truncate font-mono text-[10px]">
                      {chat.cwd ? shorten(chat.cwd) : 'no directory recorded'}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-[10px]">{when(chat.touched)}</span>
                  </span>

                  {/* `break-words`, and no `whitespace-nowrap` anywhere near
                      this. A sibling module put a 407-character string in a
                      badge whose base class had nowrap and set a 1187px
                      min-content floor under a 220px pane. An opening line is
                      exactly that kind of string. */}
                  <span className="mt-0.5 block text-xs break-words">
                    {chat.opening || <span className="text-muted-foreground italic">nothing was said</span>}
                  </span>

                  {!chat.cwd && (
                    <Badge variant="outline" className="mt-1 h-4 text-[10px] whitespace-normal">
                      cannot be reopened
                    </Badge>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/**
 * A path, shortened from the LEFT.
 *
 * The end of a path is the part that identifies it — `…/Projects/roadmap` says
 * what this is and `/Users/jo/Pro…` says only whose machine it is. Home is
 * written `~` for the same reason it is in every shell prompt.
 */
function shorten(path: string, keep = 34): string {
  const home = path.match(/^\/Users\/[^/]+/)?.[0]
  const tidy = home ? '~' + path.slice(home.length) : path
  return tidy.length <= keep ? tidy : '…' + tidy.slice(tidy.length - keep + 1)
}

/**
 * How long ago, in the coarsest unit that is still true.
 *
 * Coarse on purpose: the list is ordered by this, so the exact minute is
 * already implied by position, and "3h" beside "3h" tells a reader the two are
 * from the same afternoon better than two clock times would.
 */
function when(at: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 90) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}
