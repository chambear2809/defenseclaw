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
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
)

// NewCommandStarter returns a PTY starter for command. When command is empty,
// it re-execs this binary as "tui --skip-first-run-prompt".
func NewCommandStarter(command []string) PTYStarter {
	argv := append([]string(nil), command...)
	if len(argv) == 0 {
		argv = defaultTUICommand()
	}
	return func(ctx context.Context, size Size) (PTYSession, error) {
		return startCommandSession(ctx, argv, size)
	}
}

func defaultTUICommand() []string {
	if self, err := os.Executable(); err == nil && self != "" {
		if resolved, rerr := filepath.EvalSymlinks(self); rerr == nil {
			self = resolved
		}
		return []string{self, "tui", "--skip-first-run-prompt"}
	}
	return []string{"defenseclaw-gateway", "tui", "--skip-first-run-prompt"}
}

type commandSession struct {
	ptmx *os.File
	cmd  *exec.Cmd

	done    chan struct{}
	waitErr error

	closeOnce sync.Once
}

func startCommandSession(ctx context.Context, argv []string, size Size) (*commandSession, error) {
	if len(argv) == 0 || argv[0] == "" {
		return nil, fmt.Errorf("webtui: empty TUI command")
	}
	if size.Cols == 0 {
		size.Cols = defaultCols
	}
	if size.Rows == 0 {
		size.Rows = defaultRows
	}

	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: size.Cols, Rows: size.Rows})
	if err != nil {
		return nil, err
	}

	session := &commandSession{
		ptmx: ptmx,
		cmd:  cmd,
		done: make(chan struct{}),
	}
	go func() {
		session.waitErr = cmd.Wait()
		_ = ptmx.Close()
		close(session.done)
	}()
	return session, nil
}

func (s *commandSession) Read(p []byte) (int, error) {
	return s.ptmx.Read(p)
}

func (s *commandSession) Write(p []byte) (int, error) {
	return s.ptmx.Write(p)
}

func (s *commandSession) Resize(size Size) error {
	if size.Cols == 0 || size.Rows == 0 {
		return nil
	}
	return pty.Setsize(s.ptmx, &pty.Winsize{Cols: size.Cols, Rows: size.Rows})
}

func (s *commandSession) Terminate(grace time.Duration) error {
	if grace <= 0 {
		grace = DefaultShutdownGrace
	}
	var err error
	s.closeOnce.Do(func() {
		if s.cmd.Process != nil {
			err = s.cmd.Process.Signal(syscall.SIGHUP)
			if err != nil {
				_ = s.cmd.Process.Signal(os.Interrupt)
			}
		}
		_ = s.ptmx.Close()

		timer := time.NewTimer(grace)
		defer timer.Stop()
		select {
		case <-s.done:
			return
		case <-timer.C:
		}

		if s.cmd.Process != nil {
			_ = s.cmd.Process.Signal(syscall.SIGKILL)
			_ = s.cmd.Process.Kill()
		}
		select {
		case <-s.done:
		case <-time.After(time.Second):
		}
	})
	return err
}

func (s *commandSession) Wait() error {
	<-s.done
	return s.waitErr
}
