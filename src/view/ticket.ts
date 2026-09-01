/**
 * What the page was served, minted once per process. See `page.ts`.
 *
 * It lives in its own file because two things need it now — the terminal
 * socket, which is what it was for, and the beacon in `trace.ts`, which posts
 * the page's own standing to the server so that a frozen container can still be
 * asked what it was doing. A copy in each would be a second place to get the
 * parsing wrong.
 */
export function ticket(): string {
  const tag = document.getElementById('terminal-ticket')
  if (!tag?.textContent) return ''
  try {
    const held: unknown = JSON.parse(tag.textContent)
    return typeof held === 'string' ? held : ''
  } catch {
    /* Louder than a silent empty string, but only in the console: the page
       still renders and the socket still refuses, which is the sentence the
       person needs and it is already on screen. */
    console.error('terminal: the ticket in this page is not a JSON string')
    return ''
  }
}
