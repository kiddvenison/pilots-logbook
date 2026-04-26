# The Pilot's Logbook

A self-hosted webapp for tracking flight simulator missions. Pick a folder on your computer, and the app reads and writes everything from there: a JSON file with all your missions, journal entries, and notes; an `images/` subfolder for screenshots you take from the sim.

Originally built as a curated mission tracker for **Microsoft Flight Simulator 2024**, but works for any sim, IRL flying, or whatever you point it at.

![Pilot's Logbook screenshot placeholder](docs/screenshot.png)

## Features

- **Mission tracking.** Mark flights as flown. Progress bar shows your overall completion.
- **Notes per mission.** Anything you want to remember — fuel burn, weather, what went wrong, what you'd do differently next time.
- **Photos per mission.** Drop in screenshots from the sim. They're auto-compressed to ~500KB and saved as files in the `images/` folder.
- **Interactive map.** Every mission appears as a marker. Completed missions turn green. Click a marker to scroll to the mission.
- **Filter and search.** By category, by completion status, by free text.
- **Custom missions.** Build your own. Title, aircraft, location, description, tags, all editable.
- **Journal.** A drawer panel with two modes: a freeform notes area, or dated journal entries. Both saved alongside your missions.
- **Local-first.** Your data lives in a folder on your computer. No accounts, no servers, no telemetry. Sync it via Dropbox/iCloud/Drive if you want it on multiple machines.

## Browser Requirements

This app uses the **File System Access API** to read and write your logbook folder directly. That requires a Chromium-based browser:

## Setup

### Option 1: Use it locally (easiest)

1. Clone or download this repository.
2. Open `index.html` in Chrome/Edge/Brave.
3. Click **"Create New Logbook"** the first time.
4. Pick a folder on your computer where you want your logbook to live (e.g., `Documents/MyLogbook/`).
5. The app creates a `logbook.json` and `images/` subfolder there. From now on, just use **"Open Logbook Folder"** and pick that same folder.

### Option 2: Host it on GitHub Pages

1. Fork the repo.
2. In your fork, go to Settings → Pages → set the source to "main branch / root."
3. Visit `https://<yourname>.github.io/<reponame>/`.
4. Same flow as above — the app runs from the URL but reads/writes a folder on your local machine.

### Option 3: Host it anywhere else

It's a static site. Drop the files on Netlify, Vercel, your own webserver, etc.

## Folder Structure

When the app creates or loads a logbook folder, it expects this layout:

```
MyLogbook/
├── logbook.json     ← all your structured data
└── images/          ← photos for missions
    ├── denali-norden-a4f7....jpg
    ├── denali-norden-b8c2....jpg
    └── ...
```

The JSON file is human-readable and version-controllable. Back it up the same way you'd back up any folder.

## Sharing Logbooks

Send someone your folder (or just the `logbook.json` if you don't want to share photos) and they can open it in their own copy of the app.

If you want to publish a curated mission set as a starter for others, fork the repo and replace `logbook.json` with your version.

## Schema

`logbook.json` looks like:

```json
{
  "schemaVersion": 1,
  "title": "My Logbook",
  "subtitle": "",
  "createdAt": "2026-04-26T00:00:00Z",
  "journal": {
    "freeform": "...markdown text...",
    "entries": [
      { "id": "uuid", "date": "ISO timestamp", "body": "..." }
    ]
  },
  "categories": [
    { "id": "natural", "name": "Natural Wonders", "color": "#4a6d3a" }
  ],
  "missions": [
    {
      "id": "denali-norden",
      "title": "The Denali Job",
      "subtitle": "Talkeetna → Summit → Talkeetna",
      "category": "mountain",
      "flightTime": "~1H 45M",
      "aircraft": "Savage Norden",
      "tags": ["SIGNATURE"],
      "description": "...",
      "brief": "...",
      "lat": 63.0692,
      "lng": -151.0070,
      "completed": false,
      "completedDate": null,
      "notes": "",
      "photos": [
        { "id": "uuid", "filename": "denali-norden-uuid.jpg", "caption": "", "uploadedAt": "..." }
      ],
      "isCustom": false
    }
  ]
}
```

Edit the JSON directly if you want to bulk-import missions or rearrange categories. The app picks up changes when you reload.

## Coming Soon

- **AI Mission Generator.** Paste your Anthropic API key, answer a few questions about your sim setup, what aircraft you own, what regions interest you, and have Claude generate a custom set of missions tailored to you. Output drops straight into your logbook.

## Credits

Built originally for an MSFS 2024 NeoFly campaign. The "Curated for ___" framing came from a thought experiment about how a flight sim mission list could feel like a personal logbook instead of a generic checklist. If you find this useful, drop a screenshot of your filled-in logbook in the discussion tab — would love to see what flights other people add.
