# Lakebed Whiteboard

A real-time, multiplayer whiteboard built as a single [Lakebed](https://lakebed.dev) capsule.

**The model:** every shape is a database row, drawing is a mutation, the canvas is a live query. Multiplayer falls out for free — `useQuery("shapes")` *is* the realtime.

## Features

- Excalidraw-style tools — select, pan, rectangle, diamond, ellipse, arrow, line, freehand, text
- Live multiplayer — open the URL in two tabs and draw together
- Select to move, **resize** (corner handles) and **rotate**; **layer order** (front / back)
- Light & dark themes, canvas-background tints, grid toggle
- Custom colour picker + presets, stroke widths
- **Claim** a board to become its owner: choose who can draw, lock viewing behind a passcode
- **Optimistic** drawing — shapes appear the instant you release the pointer

## Structure

- `server/index.ts` — schema (`shapes` / `ops` / `room`), mutations, queries
- `client/index.tsx` — the Preact SVG canvas

## Run it

```sh
npx lakebed deploy
```
