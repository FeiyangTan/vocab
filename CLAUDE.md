@AGENTS.md

# Working language

**Always reply in English, whatever language jimmy writes in.** He often writes in Chinese;
answer in English anyway. Do not translate his message back to him, and do not ask which
language he wants — this is settled.

**Exception: never translate content that is deliberately Chinese.** This app is an English
vocabulary notebook *for a Chinese speaker*, so Chinese is load-bearing in several places:

- word definitions (`encounters.note`), his own notes (`words.remark`), category names
- the ECDICT glosses shown for confusables
- the `SYSTEM` / `CONTRAST_SYSTEM` prompts in `src/lib/claude.ts`, which instruct the model
  to write **Chinese** definitions
- code comments across the repo

Quote those in Chinese when you need to show them. "Reply in English" is about *your* prose,
not about the data or the codebase.

# End every reply with an English correction

jimmy is learning English, and his messages are practice. **Finish each reply with a short
`### Your English` section** that corrects the English in that turn's message.

- Give the corrected sentence first, then name each fix and **why** in a few words
  (a bare rewrite teaches nothing — the reason is the useful part).
- Only correct what he actually wrote. Skip the section entirely when his message has no
  English worth correcting (all Chinese, or just a file path / command / pasted log).
- Do not correct quoted material: code, error messages, file paths, or text he pasted from
  somewhere else. Those are data, not his writing.
- Keep it tight — a few lines. It is a footnote to the real answer, never the main event.
- Never soften a real error, and never invent one to have something to say.

# Code and commits are written in English

**Commit messages and code comments are English**, following the repo's existing
`feat:` / `fix:` / `chore:` / `docs:` convention and its habit of a body that explains
*why*, not what.

The existing 31 commits before this rule are in Chinese and **stay that way** — that was a
decision, not an oversight. Rewriting them changes every SHA, needs a force-push, and
detaches Vercel's deployment list from the repo. Do not offer to "fix" them.

🔴 **Some Chinese is load-bearing and must never be translated:**

- `src/lib/prompts.ts` — `PROCESS_SYSTEM`, `CONTRAST_SYSTEM`, `buildUserMessage`, and the
  schema `description` fields. This is what is *sent to the model*; it is what makes
  definitions come back in Chinese. Translate it and the app becomes a different product.
- `scripts/backfill-pos.mjs` — its `SYSTEM` prompt and schema descriptions, same reason.
- `src/lib/dictionary.ts` — the `/(人名|姓氏|地名|省名|城市|、如)/` regex. It matches
  **ECDICT's own gloss text**; translating it silently disables the proper-noun filter.
- `src/lib/dictionary-data.json` — ECDICT data.
- Chinese quoted *as an example* inside an English comment (a sample gloss like
  `/ˈɔltɚ/ v. 改变`). It is data being illustrated, not prose.
- `AGENTS.md` — rewritten by `next dev`; editing it just recreates the diff.
- Everything in the database: definitions, notes, category names.

The comments *around* those things are English. Only the payload is frozen.

# Browser testing must not disturb jimmy's own windows

Browser tools are pre-authorized here — no need to ask each time. But **everything happens in
a window Claude opened, and jimmy's own Chrome windows are never touched.** He works in that
browser while Claude tests.

- **Open the workspace first, explicitly:** `tabs_context_mcp { createIfEmpty: true }`, which
  opens a *new window* when no MCP group exists yet. Do not lead with a bare `navigate` — it
  calls `tabs_context_mcp` implicitly and it is then unclear whether the tab landed somewhere
  of jimmy's.
- 🔴 **`resize_window` resizes the whole window containing the tab, not the tab.** If the tab
  is sitting in one of jimmy's windows, his window shrinks under him mid-task. Never call it
  without first confirming from `tabs_context_mcp` that the group's window holds only
  Claude-created tabs. When in doubt, don't call it.
- **Prefer not resizing at all.** To check a narrow/mobile layout, constrain the container and
  measure instead — via `javascript_tool`, set `main.style.maxWidth = '358px'`, collect
  elements whose `scrollWidth > clientWidth` while `overflow-x` is `visible`, then restore the
  original style. That catches real horizontal overflow, touches no window, and cannot
  disturb anything. Resize only when a CSS media query itself is what's under test.
- **Never navigate, reload, or close a tab Claude did not create.** Close every tab Claude did
  create once done; when the group's last tab closes, Chrome removes the group and its window.
- Same rule for anything else window-level (fullscreen, moving, focus stealing): if it can be
  felt in a window jimmy is using, it does not happen.

# Personal pronouns

The global rule about annotating 你 / 我 still applies, rendered in English as
**"you (jimmy)"** and **"I (Claude)"**. The reason it exists is language-independent: these
conversations contain several actors — jimmy, Claude, the author of some commit, and
personified systems ("the backend", "Vercel") — and a bare "you" often takes a re-read to
resolve. Same boundaries as the global rule: leave quoted text alone, and name third
parties directly instead of writing "he".
