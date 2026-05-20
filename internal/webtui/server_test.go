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
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type fakeStarter struct {
	mu       sync.Mutex
	starts   []Size
	sessions []*fakeSession
	startCh  chan *fakeSession
	err      error
}

func newFakeStarter() *fakeStarter {
	return &fakeStarter{startCh: make(chan *fakeSession, 8)}
}

func (s *fakeStarter) start(_ context.Context, size Size) (PTYSession, error) {
	if s.err != nil {
		return nil, s.err
	}
	session := newFakeSession()
	s.mu.Lock()
	s.starts = append(s.starts, size)
	s.sessions = append(s.sessions, session)
	s.mu.Unlock()
	s.startCh <- session
	return session, nil
}

func (s *fakeStarter) startCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.starts)
}

func (s *fakeStarter) startSize(i int) Size {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.starts[i]
}

func (s *fakeStarter) waitSession(t *testing.T) *fakeSession {
	t.Helper()
	select {
	case session := <-s.startCh:
		return session
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for PTY session start")
		return nil
	}
}

type fakeSession struct {
	output     chan []byte
	input      chan []byte
	resize     chan Size
	closed     chan struct{}
	terminated chan struct{}
	closeOnce  sync.Once
}

func newFakeSession() *fakeSession {
	return &fakeSession{
		output:     make(chan []byte, 8),
		input:      make(chan []byte, 8),
		resize:     make(chan Size, 8),
		closed:     make(chan struct{}),
		terminated: make(chan struct{}),
	}
}

func (s *fakeSession) Read(p []byte) (int, error) {
	select {
	case data := <-s.output:
		return copy(p, data), nil
	case <-s.closed:
		return 0, io.EOF
	}
}

func (s *fakeSession) Write(p []byte) (int, error) {
	cp := append([]byte(nil), p...)
	select {
	case s.input <- cp:
	case <-s.closed:
		return 0, io.ErrClosedPipe
	}
	return len(p), nil
}

func (s *fakeSession) Resize(size Size) error {
	select {
	case s.resize <- size:
	case <-s.closed:
		return io.ErrClosedPipe
	}
	return nil
}

func (s *fakeSession) Terminate(time.Duration) error {
	s.closeOnce.Do(func() {
		close(s.terminated)
		close(s.closed)
	})
	return nil
}

func (s *fakeSession) Wait() error {
	<-s.closed
	return nil
}

func TestHealthzDoesNotStartTUI(t *testing.T) {
	starter := newFakeStarter()
	srv := newTestHTTPServer(t, starter, 1)

	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want 200", resp.StatusCode)
	}
	body := &bytes.Buffer{}
	_, _ = body.ReadFrom(resp.Body)
	if body.String() != "ok\n" {
		t.Fatalf("body=%q, want ok", body.String())
	}
	if got := starter.startCount(); got != 0 {
		t.Fatalf("healthz started %d TUI session(s), want 0", got)
	}
}

func TestSameOriginWebSocketSucceedsAndCrossOriginFails(t *testing.T) {
	starter := newFakeStarter()
	srv := newTestHTTPServer(t, starter, 1)

	conn, resp, err := dialWebTUI(srv, srv.URL, "?cols=100&rows=40")
	if err != nil {
		t.Fatalf("same-origin websocket dial: %v", err)
	}
	if resp == nil || resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("same-origin status=%v, want 101", statusCode(resp))
	}
	session := starter.waitSession(t)
	closeWebSocket(t, conn)
	waitTerminated(t, session)

	conn, resp, err = dialWebTUI(srv, "http://evil.example", "?cols=100&rows=40")
	if err == nil {
		closeWebSocket(t, conn)
		t.Fatal("cross-origin websocket unexpectedly succeeded")
	}
	if resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin status=%v, want 403", statusCode(resp))
	}
	if got := starter.startCount(); got != 1 {
		t.Fatalf("cross-origin request started session count=%d, want 1", got)
	}
}

func TestWebSocketStartsWithRequestedSizeAndResizes(t *testing.T) {
	starter := newFakeStarter()
	srv := newTestHTTPServer(t, starter, 1)

	conn, _, err := dialWebTUI(srv, srv.URL, "?cols=132&rows=43")
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	session := starter.waitSession(t)
	if got := starter.startSize(0); got != (Size{Cols: 132, Rows: 43}) {
		t.Fatalf("initial size=%+v, want 132x43", got)
	}

	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"resize","cols":88,"rows":31}`)); err != nil {
		t.Fatalf("write resize: %v", err)
	}
	select {
	case got := <-session.resize:
		if got != (Size{Cols: 88, Rows: 31}) {
			t.Fatalf("resize=%+v, want 88x31", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for resize")
	}

	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"resize","cols":9999,"rows":1}`)); err != nil {
		t.Fatalf("write bounded resize: %v", err)
	}
	select {
	case got := <-session.resize:
		if got != (Size{Cols: maxCols, Rows: minRows}) {
			t.Fatalf("bounded resize=%+v, want %dx%d", got, maxCols, minRows)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for bounded resize")
	}

	closeWebSocket(t, conn)
	waitTerminated(t, session)
}

func TestSecondSessionReturnsConflictWhenMaxSessionsOne(t *testing.T) {
	starter := newFakeStarter()
	srv := newTestHTTPServer(t, starter, 1)

	first, _, err := dialWebTUI(srv, srv.URL, "?cols=80&rows=24")
	if err != nil {
		t.Fatalf("first dial: %v", err)
	}
	firstSession := starter.waitSession(t)

	second, resp, err := dialWebTUI(srv, srv.URL, "?cols=80&rows=24")
	if err == nil {
		closeWebSocket(t, second)
		t.Fatal("second websocket unexpectedly succeeded")
	}
	if resp == nil || resp.StatusCode != http.StatusConflict {
		t.Fatalf("second status=%v, want 409", statusCode(resp))
	}
	if got := starter.startCount(); got != 1 {
		t.Fatalf("start count=%d, want 1", got)
	}

	closeWebSocket(t, first)
	waitTerminated(t, firstSession)
}

func TestWebSocketCloseTerminatesChild(t *testing.T) {
	starter := newFakeStarter()
	srv := newTestHTTPServer(t, starter, 1)

	conn, _, err := dialWebTUI(srv, srv.URL, "?cols=80&rows=24")
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	session := starter.waitSession(t)
	closeWebSocket(t, conn)
	waitTerminated(t, session)
}

func TestMalformedFramesDoNotLeakSession(t *testing.T) {
	starter := newFakeStarter()
	srv := newTestHTTPServer(t, starter, 1)

	conn, _, err := dialWebTUI(srv, srv.URL, "?cols=80&rows=24")
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	session := starter.waitSession(t)

	for _, payload := range []string{
		`not-json`,
		`{"type":"resize","cols":0,"rows":0}`,
		`{"type":"input","data":"ignored"}`,
	} {
		if err := conn.WriteMessage(websocket.TextMessage, []byte(payload)); err != nil {
			t.Fatalf("write text frame %q: %v", payload, err)
		}
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, []byte("abc")); err != nil {
		t.Fatalf("write binary input: %v", err)
	}
	select {
	case got := <-session.input:
		if string(got) != "abc" {
			t.Fatalf("input=%q, want abc", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for binary input")
	}

	closeWebSocket(t, conn)
	waitTerminated(t, session)

	next, _, err := dialWebTUI(srv, srv.URL, "?cols=80&rows=24")
	if err != nil {
		t.Fatalf("dial after malformed frames: %v", err)
	}
	nextSession := starter.waitSession(t)
	closeWebSocket(t, next)
	waitTerminated(t, nextSession)
}

func newTestHTTPServer(t *testing.T, starter *fakeStarter, maxSessions int) *httptest.Server {
	t.Helper()
	server, err := New(Config{
		MaxSessions:   maxSessions,
		ShutdownGrace: 25 * time.Millisecond,
		Starter:       starter.start,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	srv := httptest.NewServer(server.Handler())
	t.Cleanup(srv.Close)
	return srv
}

func dialWebTUI(srv *httptest.Server, origin string, query string) (*websocket.Conn, *http.Response, error) {
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws" + query
	headers := http.Header{}
	if origin != "" {
		headers.Set("Origin", origin)
	}
	return websocket.DefaultDialer.Dial(wsURL, headers)
}

func closeWebSocket(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	if conn == nil {
		return
	}
	_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
	_ = conn.Close()
}

func waitTerminated(t *testing.T, session *fakeSession) {
	t.Helper()
	select {
	case <-session.terminated:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for session termination")
	}
}

func statusCode(resp *http.Response) int {
	if resp == nil {
		return 0
	}
	return resp.StatusCode
}
