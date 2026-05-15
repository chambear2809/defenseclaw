# DefenseClaw Tokenomics Prebuilt Demo

This package includes a prebuilt `dist/` directory, so you do not need to run
`npm install`.

## Run

```bash
./run-prebuilt-tokenomics-demo.sh
```

Then open:

```text
http://127.0.0.1:3001/?view=tokenomics
```

The runner starts:

- the prebuilt MFE on `http://127.0.0.1:3001`
- the fixture tokenomics API on `http://127.0.0.1:8787`

## Notes

- Requires Node.js 18+.
- This is fixture-backed demo data, not live O11y telemetry.
- Press `Ctrl+C` in the terminal to stop both servers.
