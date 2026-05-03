# Imperium Recorder — Chrome Extension

Record browser workflows directly from Chrome and save them as [imperium-crawl](https://github.com/ceoimperiumprojects/imperium-crawl) flows.

## Features

- **Record** — captures clicks, typing, scrolling, navigation, and form fills on any page
- **Side Panel UI** — opens as a Chrome side panel, doesn't block your browsing
- **Real-time preview** — see every action as you perform it
- **Save as Flow** — exports directly to imperium-crawl compatible format
- **Flow management** — browse, delete, and copy saved flows
- **Agent-native** — run flows from CLI: `imperiumcrawl run-flow <family>/<variant>`
- **Your Chrome profile** — uses your real cookies, logins, and sessions. No separate browser needed.

## Install

1. Clone or download this directory
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `chrome-extension/` directory

## Usage

### Recording a workflow

1. Click the Imperium Recorder icon in your toolbar
2. Side panel opens → click **Start Recording**
3. Perform your actions on the page (click, type, scroll, navigate)
4. Click **Stop Recording** when done
5. Click **Save Flow** → enter family/variant name
6. The flow is saved and copied to clipboard

### Running a saved flow

```bash
# From CLI (with imperium-crawl installed)
imperiumcrawl run-flow <family>/<variant>

# Example
imperiumcrawl run-flow linkedin-search/default
```

### Keyboard shortcut

`Ctrl+Shift+R` — toggle recording on/off

## Flow format

Recorded flows use the exact same format as imperium-crawl's `ActionInput`:

```json
{
  "family": "linkedin-search",
  "variant": "default",
  "steps": [
    { "id": "step_1", "type": "navigate", "url": "https://linkedin.com" },
    { "id": "step_2", "type": "click", "selector": "#search-input" },
    { "id": "step_3", "type": "type", "selector": "#search-input", "text": "CEO" }
  ]
}
```

## Architecture

```
chrome-extension/
├── manifest.json       ← Chrome MV3 manifest
├── sidepanel.html      ← Side panel UI
├── sidepanel.js        ← UI logic + state management
├── content.js          ← Injected into pages; captures actions
├── background.js       ← Service worker; coordinates messages
├── lib/
│   └── action-types.js ← Shared ActionInput types (matches imperium-crawl)
└── icons/              ← Extension icons
```

## Requirements

- Chrome 114+ (for Side Panel API)
- [imperium-crawl](https://www.npmjs.com/package/imperium-crawl) — for running recorded flows via CLI

## License

MIT
