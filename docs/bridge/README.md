# Bridge TUI

The **Bridge** is the lightweight terminal dashboard built with **Ink**. It visualises the current state of a Citadel run in real‑time, allowing developers to monitor agents, molecules and overall workflow status.

## Features

- **Real‑time updates** – Uses Conductor events to refresh the UI without polling.
- **Agent matrix** – Shows each agent’s state (`Open`, `In Progress`, `Verify`, `Done`) and any logs.
- **Molecule tree** – Visualises the DAG of molecules for the current run.
- **Keyboard shortcuts** – Resize panels with the mouse or use arrow keys; press **Ctrl+C** to exit.

## Getting started

```bash
# Make sure you have Bun installed
bun install

# Run a formula through the Conductor
citadel start

# In a separate terminal, launch the Bridge
citadel bridge  # or the bundled script
# Equivalent shell command
bun run script:bridge
```

The dashboard will automatically connect to the Conductor instance running on `localhost:2333` and stream updates.

## Extending the UI

- **Add new panels** – Create a React component inside `src/bridge/components` and import it into `Dashboard.tsx`.
- **Custom event handling** – Replace the Polling logic (currently in `AgentMatrix`/`MoleculeTree`) with event listeners from the global `ConductorEventBus`.
- **Styling** – Use Ink’s `Box` and `Text` components; you can also integrate Ink themes.

## Development notes

- The Bridge entry point is `src/bridge/index.tsx`.
- It relies on the shared `CitadelLogger` for logs and the global `Conductor` instance for state.
- Running `bun run script:bridge` will execute `node --loader ts-node/esm src/bridge/index.tsx`.

---

For more information, refer to the main project `README.md` and the `docs` folder.
