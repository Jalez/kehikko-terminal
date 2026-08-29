/**
 * The document served at `/app`, built here rather than read off disk.
 *
 * ## Why it is generated
 *
 * The ticket. It is minted once per process and has to reach the page without
 * being fetchable on a door of its own — a `GET /api/ticket` would be exactly
 * the endpoint the ticket exists to make unnecessary, readable by anything that
 * can reach the port. Printed into the document, it is reachable by whatever
 * can read the document, which under `storage: true` and no CORS is this page
 * and nothing in another tab. See `TICKET` in `shell.ts`.
 *
 * That matters more here than in any sibling module, because what the ticket
 * stands in front of is a shell.
 *
 * It also sidesteps a collision Atlas lost half a day to. `entry` is `/app`,
 * and under Vite dev an extensionless path is not free: a request for `/app`
 * next to an `app.tsx` resolves to that module and answers `200
 * text/javascript` with compiled source. A browser loads such a document
 * happily and runs nothing in it — the frame's `load` fires, the host greets
 * it, and nothing answers. Here `/app` is claimed before Vite's resolver sees
 * it, so no file that happens to sit next to this one can take it.
 *
 * ## Why the ticket is in a JSON script tag
 *
 * Not an attribute on a div, and not a global assignment. A `<script
 * type="application/json">` body is not executed and not parsed as HTML, so a
 * uuid cannot become markup on its way in — and reading it back with
 * `JSON.parse` means the page fails loudly on anything unexpected rather than
 * quietly holding the string `"undefined"` and sending it as a ticket.
 */
export function page(ticket: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Terminal</title>
    <script id="terminal-ticket" type="application/json">${JSON.stringify(ticket)}</script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
}
