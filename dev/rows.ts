/**
 * The rows this module declares, from the real header and footer functions, for `kehikot-check-rows`
 * (protocol 2.70.0): one state per view a person meets. `bun dev/rows.ts` writes `kehikot.rows.json`;
 * `test/rows.test.ts` says when the file is behind the functions, and runs the check over it.
 */
import { writeFileSync } from 'node:fs'

import { footerItems } from '../src/view/footer.ts'
import { headerItems } from '../src/view/header.ts'

const NAME = 'Terminal'
const status = (busy: string | null) => ({ cwd: '/Users/me/project', shown: '~/project', shell: 'zsh', busy })

export const rows = [
  {
    name: 'a shell at its prompt',
    header: headerItems({ shell: true, dead: false, relocated: false, why: null, drawsFooter: true }),
    footer: footerItems({ cover: null, shell: true, name: NAME, status: status(null) }),
    state: true,
  },
  {
    name: 'a command running, the folder renamed',
    header: headerItems({ shell: true, dead: false, relocated: true, why: null, drawsFooter: true }),
    footer: footerItems({ cover: null, shell: true, name: NAME, status: status('vim'), renamed: '~/renamed' }),
    state: true,
  },
  {
    name: 'the shell ended',
    header: headerItems({ shell: true, dead: true, relocated: false, why: 'exit 0', drawsFooter: true }),
    footer: footerItems({ cover: null, shell: true, name: NAME, status: status(null), ended: 'exit 0' }),
    state: true,
  },
  {
    name: 'its server down under the last screen',
    header: headerItems({ shell: true, dead: true, relocated: false, why: 'the connection ended', drawsFooter: true }),
    footer: footerItems({ cover: 'down', shell: true, name: NAME }),
    state: true,
  },
]

if (import.meta.main) {
  writeFileSync(new URL('../kehikot.rows.json', import.meta.url), `${JSON.stringify(rows, null, 2)}\n`)
  console.log(`kehikot.rows.json: ${rows.length} states`)
}
