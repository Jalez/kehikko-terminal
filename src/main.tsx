import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
/**
 * Imported for its side effect, and the order on this page is the whole point.
 *
 * The client installs the one `message` listener at module scope, so it is
 * listening as part of this bundle being evaluated — which is before React has
 * rendered anything, let alone run an effect. The host greets on the frame's
 * `load` event, and effects run strictly after that, so a listener installed in
 * `useEffect` is installed after the greeting has already been posted and thrown
 * away. See the essay in the client's `mailbox.ts`; it is a bug that costs an
 * afternoon and whose only symptom is a container reporting a module that will not
 * speak.
 *
 * It is imported HERE, from the entry, rather than wherever `connect` is called
 * — a module scope that only a lazily-loaded chunk imports is a module scope
 * that has not run yet, which is the same bug wearing a bundler's clothes.
 */
import 'roadmap-module-protocol/client'
import { App } from './app.tsx'
import { keepFramesComing } from './view/frames.ts'
import { watchThisPage } from './view/trace.ts'

/**
 * Before anything on this page asks for a frame.
 *
 * "It stops showing what I type until I switch to another app": the window
 * serves this frame one animation frame every ten seconds, and xterm draws
 * only inside one. From here on a frame that is owed is drawn from a one-shot
 * timer instead, once, without waiting. `src/view/frames.ts` has the
 * measurement, and why this is not the repaint loop that file's predecessor
 * argued against.
 */
keepFramesComing()

/**
 * Started from the entry, and not from the terminal view, because it has to
 * survive the view.
 *
 * "Clicking New shell doesn't fix it either" means the thing that stopped is
 * not the shell, the socket or the emulator — all three are replaced by that
 * press. It is something at the level of this page. A tracer that lived inside
 * `TerminalView` would be torn down and rebuilt by exactly the press whose
 * effect is being measured, and would report a healthy new one every time while
 * the sick old one went unmentioned.
 *
 * So this runs once per document, counts what the views mount and release, and
 * posts it to the server every couple of seconds — where `curl` can read it
 * while the page in front of somebody is stuck. See `src/view/trace.ts`.
 */
watchThisPage()

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
