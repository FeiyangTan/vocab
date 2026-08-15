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
