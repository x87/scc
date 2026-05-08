# scc

Converter from Grand Theft Auto III `gta3script` (`.sc`) toward CLEO Redux JavaScript.

## Requirements

- [Bun](https://bun.sh) (tests and CLI use `bun`)

## CLI

Convert a single file or an entire tree. Output keeps the same relative paths as input, with `.sc` replaced by `.js`. 

```bash
bun run cli <path/to/file.sc-or-folder> [-o out-dir] [--strict] [--report report.json]
```

- **`--out` / `-o`** — output directory (default: `out`).
- **`--strict`** — fail on unknown SCM opcodes instead of emitting a thrown placeholder.
- **`--split-main-labels`** — when converting `main.sc`, also emit sibling `main.<label>.js` modules (each with its own `SCM.bind` wiring to the same slots); main output keeps the preamble-only flow.
- **`--report`** — write JSON with scope metadata (renames, `GOSUB_FILE` hints, script labels, etc.).

### Example

```bash
bun run cli GTA_III_SCRIPT-master -o output
```
