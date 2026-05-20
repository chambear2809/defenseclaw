// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package webtui

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	DefaultBind          = "127.0.0.1"
	DefaultPort          = 18971
	DefaultMaxSessions   = 1
	DefaultShutdownGrace = 5 * time.Second

	defaultCols = 120
	defaultRows = 36
	minCols     = 2
	maxCols     = 500
	minRows     = 2
	maxRows     = 200

	maxClientFrameBytes = 64 * 1024
	pongWait            = 60 * time.Second
	pingPeriod          = 25 * time.Second
	writeWait           = 10 * time.Second
)

//go:embed assets/*
var embeddedAssets embed.FS

// Size describes a terminal geometry in character cells.
type Size struct {
	Cols uint16
	Rows uint16
}

// PTYSession is the PTY-backed process contract used by the WebSocket proxy.
// It is intentionally small so tests can use a fake session without spawning a
// full-screen Bubble Tea program.
type PTYSession interface {
	io.Reader
	io.Writer
	Resize(Size) error
	Terminate(time.Duration) error
	Wait() error
}

// PTYStarter starts a new terminal session with the requested initial size.
type PTYStarter func(context.Context, Size) (PTYSession, error)

// Config controls the web TUI HTTP/WebSocket server.
type Config struct {
	Bind          string
	Port          int
	MaxSessions   int
	ShutdownGrace time.Duration
	Starter       PTYStarter
	Command       []string
	Context       context.Context
}

// Addr returns the normalized TCP listen address.
func (c Config) Addr() string {
	c = c.normalized()
	return net.JoinHostPort(c.Bind, strconv.Itoa(c.Port))
}

func (c Config) normalized() Config {
	if c.Bind == "" {
		c.Bind = DefaultBind
	}
	if c.Port <= 0 || c.Port > 65535 {
		c.Port = DefaultPort
	}
	if c.MaxSessions <= 0 {
		c.MaxSessions = DefaultMaxSessions
	}
	if c.ShutdownGrace <= 0 {
		c.ShutdownGrace = DefaultShutdownGrace
	}
	if c.Starter == nil {
		c.Starter = NewCommandStarter(c.Command)
	}
	if c.Context == nil {
		c.Context = context.Background()
	}
	return c
}

// Server serves the browser-hosted terminal UI.
type Server struct {
	cfg      Config
	ctx      context.Context
	sessions chan struct{}
	assets   fs.FS
}

// New creates a web TUI server from cfg.
func New(cfg Config) (*Server, error) {
	cfg = cfg.normalized()
	assets, err := fs.Sub(embeddedAssets, "assets")
	if err != nil {
		return nil, fmt.Errorf("webtui assets: %w", err)
	}
	return &Server{
		cfg:      cfg,
		ctx:      cfg.Context,
		sessions: make(chan struct{}, cfg.MaxSessions),
		assets:   assets,
	}, nil
}

// Handler returns the HTTP handler for tests and embedding.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/healthz", s.handleHealthz)
	mux.HandleFunc("/ws", s.handleWebSocket)
	mux.Handle("/assets/", http.StripPrefix("/assets/", http.FileServer(http.FS(s.assets))))
	return mux
}

// ListenAndServe runs the HTTP server until ctx is canceled.
func ListenAndServe(ctx context.Context, cfg Config) error {
	cfg.Context = ctx
	webServer, err := New(cfg)
	if err != nil {
		return err
	}
	cfg = webServer.cfg

	httpServer := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           webServer.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext: func(net.Listener) context.Context {
			return ctx
		},
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- httpServer.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownGrace)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		err := <-errCh
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method == http.MethodHead {
		return
	}
	data, err := fs.ReadFile(s.assets, "index.html")
	if err != nil {
		http.Error(w, "web TUI asset missing", http.StatusInternalServerError)
		return
	}
	_, _ = w.Write(data)
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method == http.MethodHead {
		return
	}
	_, _ = io.WriteString(w, "ok\n")
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !sameOrigin(r) {
		http.Error(w, "websocket origin rejected", http.StatusForbidden)
		return
	}
	if !websocket.IsWebSocketUpgrade(r) {
		http.Error(w, "websocket upgrade required", http.StatusBadRequest)
		return
	}
	if !s.acquireSession() {
		http.Error(w, "maximum web TUI sessions active", http.StatusConflict)
		return
	}

	size := sizeFromQuery(r.URL.Query())
	ctx, cancel := context.WithCancel(s.ctx)
	session, err := s.cfg.Starter(ctx, size)
	if err != nil {
		fmt.Fprintf(os.Stderr, "webtui: failed to start TUI session: %v\n", err)
		cancel()
		s.releaseSession()
		http.Error(w, "failed to start TUI session", http.StatusInternalServerError)
		return
	}

	upgrader := websocket.Upgrader{
		ReadBufferSize:  32 * 1024,
		WriteBufferSize: 32 * 1024,
		CheckOrigin:     sameOrigin,
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		cancel()
		_ = session.Terminate(s.cfg.ShutdownGrace)
		s.releaseSession()
		return
	}

	go func() {
		defer cancel()
		defer s.releaseSession()
		defer conn.Close()
		defer session.Terminate(s.cfg.ShutdownGrace)
		s.proxySession(ctx, conn, session)
	}()
}

func (s *Server) acquireSession() bool {
	select {
	case s.sessions <- struct{}{}:
		return true
	default:
		return false
	}
}

func (s *Server) releaseSession() {
	select {
	case <-s.sessions:
	default:
	}
}

func (s *Server) proxySession(ctx context.Context, conn *websocket.Conn, session PTYSession) {
	conn.SetReadLimit(maxClientFrameBytes)
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	done := make(chan struct{})
	var doneOnce sync.Once
	closeDone := func() {
		doneOnce.Do(func() { close(done) })
	}

	var writeMu sync.Mutex
	writeFrame := func(messageType int, payload []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		if err := conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
			return err
		}
		return conn.WriteMessage(messageType, payload)
	}

	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		defer closeDone()
		buf := make([]byte, 32*1024)
		for {
			n, err := session.Read(buf)
			if n > 0 {
				payload := append([]byte(nil), buf[:n]...)
				if writeFrame(websocket.BinaryMessage, payload) != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	pingDone := make(chan struct{})
	go func() {
		defer close(pingDone)
		ticker := time.NewTicker(pingPeriod)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-done:
				return
			case <-ticker.C:
				if writeFrame(websocket.PingMessage, nil) != nil {
					closeDone()
					_ = conn.Close()
					return
				}
			}
		}
	}()

readLoop:
	for {
		select {
		case <-ctx.Done():
			break readLoop
		case <-done:
			break readLoop
		default:
		}

		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			break
		}
		switch messageType {
		case websocket.BinaryMessage:
			if len(payload) == 0 {
				continue
			}
			if _, err := session.Write(payload); err != nil {
				break readLoop
			}
		case websocket.TextMessage:
			_ = handleTextFrame(session, payload)
		}
	}

	closeDone()
	_ = conn.Close()
	_ = session.Terminate(s.cfg.ShutdownGrace)
	waitFor(writerDone, s.cfg.ShutdownGrace)
	waitFor(pingDone, s.cfg.ShutdownGrace)
	_ = session.Wait()
}

func waitFor(ch <-chan struct{}, timeout time.Duration) {
	if timeout <= 0 {
		timeout = DefaultShutdownGrace
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-ch:
	case <-timer.C:
	}
}

func handleTextFrame(session PTYSession, payload []byte) error {
	var msg struct {
		Type string `json:"type"`
		Cols int    `json:"cols"`
		Rows int    `json:"rows"`
	}
	if err := json.Unmarshal(payload, &msg); err != nil {
		return nil
	}
	if msg.Type != "resize" {
		return nil
	}
	size, ok := boundedResize(msg.Cols, msg.Rows)
	if !ok {
		return nil
	}
	return session.Resize(size)
}

func sizeFromQuery(values url.Values) Size {
	cols, _ := strconv.Atoi(values.Get("cols"))
	rows, _ := strconv.Atoi(values.Get("rows"))
	size, ok := boundedResize(cols, rows)
	if !ok {
		return Size{Cols: defaultCols, Rows: defaultRows}
	}
	return size
}

func boundedResize(cols, rows int) (Size, bool) {
	if cols <= 0 && rows <= 0 {
		return Size{}, false
	}
	if cols <= 0 {
		cols = defaultCols
	}
	if rows <= 0 {
		rows = defaultRows
	}
	cols = clamp(cols, minCols, maxCols)
	rows = clamp(rows, minRows, maxRows)
	return Size{Cols: uint16(cols), Rows: uint16(rows)}, true
}

func clamp(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func sameOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return false
	}
	if !strings.EqualFold(parsed.Host, r.Host) {
		return false
	}
	expectedScheme := requestScheme(r)
	return strings.EqualFold(parsed.Scheme, expectedScheme)
}

func requestScheme(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	if forwarded := r.Header.Get("X-Forwarded-Proto"); forwarded != "" {
		first, _, _ := strings.Cut(forwarded, ",")
		first = strings.ToLower(strings.TrimSpace(first))
		if first == "http" || first == "https" {
			return first
		}
	}
	return "http"
}
