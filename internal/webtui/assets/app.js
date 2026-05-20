(function () {
  "use strict";

  const terminalElement = document.getElementById("terminal");
  const statusElement = document.getElementById("status");
  const encoder = new TextEncoder();

  const terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: "block",
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: 14,
    lineHeight: 1.1,
    scrollback: 5000,
    theme: {
      background: "#0a0d10",
      foreground: "#d6dde5",
      cursor: "#f4f7fb",
      selectionBackground: "#2f6f90",
      black: "#111827",
      red: "#f87171",
      green: "#34d399",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#d1d5db",
      brightBlack: "#6b7280",
      brightRed: "#fb7185",
      brightGreen: "#6ee7b7",
      brightYellow: "#fde68a",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#f9fafb"
    }
  });

  const fitAddon = new FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalElement);

  function setStatus(text, state) {
    statusElement.textContent = text;
    if (state) {
      statusElement.dataset.state = state;
    } else {
      delete statusElement.dataset.state;
    }
  }

  function fit() {
    fitAddon.fit();
  }

  fit();
  terminal.focus();

  const wsScheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsScheme}//${window.location.host}/ws?cols=${terminal.cols}&rows=${terminal.rows}`;
  const socket = new WebSocket(wsUrl);
  socket.binaryType = "arraybuffer";

  socket.addEventListener("open", function () {
    setStatus("Connected", "open");
    terminal.focus();
    sendResize();
  });

  socket.addEventListener("message", function (event) {
    if (event.data instanceof ArrayBuffer) {
      terminal.write(new Uint8Array(event.data));
      return;
    }
    if (event.data instanceof Blob) {
      event.data.arrayBuffer().then(function (buffer) {
        terminal.write(new Uint8Array(buffer));
      });
    }
  });

  socket.addEventListener("close", function (event) {
    const suffix = event.reason ? `: ${event.reason}` : "";
    setStatus(`Disconnected${suffix}`, "closed");
  });

  socket.addEventListener("error", function () {
    setStatus("Connection error", "error");
  });

  terminal.onData(function (data) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(encoder.encode(data));
    }
  });

  function sendResize() {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify({
      type: "resize",
      cols: terminal.cols,
      rows: terminal.rows
    }));
  }

  let resizeTimer = 0;
  function scheduleResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      fit();
      sendResize();
    }, 80);
  }

  window.addEventListener("resize", scheduleResize);
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(terminalElement);
  }
})();
