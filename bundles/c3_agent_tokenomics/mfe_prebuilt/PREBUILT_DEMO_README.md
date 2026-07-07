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

Without additional configuration, the runner starts:

- the prebuilt MFE on `http://127.0.0.1:3001`
- the fixture tokenomics API on `http://127.0.0.1:8787`

For the live control path, point the same runner at the internal BFF:

```bash
TOKENOMICS_BFF_URL="http://127.0.0.1:8788" ./run-prebuilt-tokenomics-demo.sh
```

The local port `8787` then acts as a same-origin proxy for live usage, alerts,
and apply/release operations. Upstream requests fail with a bounded `502` or
`504` response instead of hanging indefinitely.

## Notes

- Requires Node.js 18+.
- Fixture mode is read-only and clearly marked. The EKS deployment uses live
  DefenseClaw data with fixture fallback disabled.
- Press `Ctrl+C` in the terminal to stop both servers.
