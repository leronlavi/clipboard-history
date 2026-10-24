# clipboard-history

A Claude Code mod that keeps a pane beside the chat listing what you copy, text and screenshots, so you can drop any of it back into the prompt.

- **Text and screenshots.** Everything you copy on your Mac shows up at the top of the pane with the time. Screenshots get a short name made from the app that was in front and the text in the picture ("Play Console app signing key"), and a preview in terminals that draw images (Ghostty, kitty, iTerm2).
- **Back into the prompt.** Press an entry to copy it again (⌘V for text, Ctrl+V in the prompt to attach a screenshot), or press **↵** to put it in the prompt at the cursor (a screenshot goes in as its file path).
- **Remove what's sensitive.** **✕** removes one entry and deletes its image file; **Clear all** empties the list. Copies that password managers mark as concealed are never listed.
- Keeps the last 50 entries across sessions. `/clipboard` opens the pane again.

The pane docks on the right in Claude Code's fullscreen layout from 110 columns, and sits above the prompt otherwise.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install clipboard-history --marketplace leronlavi/clipboard-history
```

Answer `y` to add the marketplace, then pick a scope (user makes it work in every session).

From a shell:

```
claude plugin install clipboard-history --marketplace leronlavi/clipboard-history
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `leronlavi/clipboard-history`, then Add plugin.

## Requirements and privacy

- **macOS only.** It watches the clipboard with a small JavaScript for Automation script (`scripts/clipboard-watch.js`) run by `osascript`, and reads text in screenshots with macOS's built-in Vision text recognition (`scripts/screenshot-text.js`).
- Screenshots are saved as PNGs in `~/.claude/clipboard-history/`; the list itself is kept in Claude Code's plugin store.
- To name a screenshot, the text read from it and the name of the app in front are sent to Claude Haiku on your own Claude Code account. A screenshot with no text is named after its app, with no model call.

## License

MIT
