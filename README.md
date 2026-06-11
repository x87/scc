# scc

Converter from GTA3script `.sc` files toward CLEO Redux TypeScript.

## Requirements

- [Bun](https://bun.sh) (tests and CLI use `bun`)

## CLI

Convert a single file or an entire tree. Output keeps the same relative paths as input, with `.sc` replaced by `.ts`.

```bash
bun run cli <path/to/file.sc-or-folder> [-o out-dir] --config <config-folder> [--report report.json]
```

- **`--out` / `-o`** — output directory (default: `out`).
- **`--config`** (required) — config folder containing converter metadata JSON (`<folder>.json`, `vars.json`, `consts.json`, `objs.json`, `enums.json`).
- **`--report`** — write JSON with scope metadata (renames, `GOSUB_FILE` hints, script labels, etc.).

### Examples

**Convert GTA III scripts:**
```bash
bun run cli GTA_III_SCRIPT-master -o output --config gta3
```

**Convert Vice City scripts:**
```bash
bun run cli GTA_VC_SCRIPT-master -o output --config vc
```

**Convert a single script file:**
```bash
bun run cli GTA_VC_SCRIPT-master/main/ambulance.sc -o output --config vc
```

**Generate scope report:**
```bash
bun run cli GTA_III_SCRIPT-master -o output --config gta3 --report metadata.json
```
