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

package cli

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/defenseclaw/defenseclaw/internal/webtui"
)

var (
	webTUIBind          string
	webTUIPort          int
	webTUIMaxSessions   int
	webTUIShutdownGrace time.Duration
)

var webTUICmd = &cobra.Command{
	Use:   "web-tui",
	Short: "Serve the DefenseClaw TUI over HTTP and WebSocket",
	Long: `Serve a browser-hosted DefenseClaw TUI.

The HTTP server upgrades /ws to a PTY-backed terminal session that runs
"defenseclaw-gateway tui --skip-first-run-prompt".`,
	RunE:              runWebTUI,
	PersistentPreRunE: runWebTUIPre,
}

func init() {
	webTUICmd.Flags().StringVar(&webTUIBind, "bind", webtui.DefaultBind, "Address to bind the web TUI server")
	webTUICmd.Flags().IntVar(&webTUIPort, "port", webtui.DefaultPort, "Port for the web TUI server")
	webTUICmd.Flags().IntVar(&webTUIMaxSessions, "max-sessions", webtui.DefaultMaxSessions, "Maximum concurrent browser TUI sessions")
	webTUICmd.Flags().DurationVar(&webTUIShutdownGrace, "shutdown-grace", webtui.DefaultShutdownGrace, "Grace period for HTTP shutdown and TUI child cleanup")
	rootCmd.AddCommand(webTUICmd)
}

func runWebTUIPre(_ *cobra.Command, _ []string) error {
	return nil
}

func runWebTUI(cmd *cobra.Command, _ []string) error {
	if webTUIMaxSessions <= 0 {
		return fmt.Errorf("--max-sessions must be greater than zero")
	}
	if webTUIPort <= 0 || webTUIPort > 65535 {
		return fmt.Errorf("--port must be between 1 and 65535")
	}
	if webTUIShutdownGrace <= 0 {
		return fmt.Errorf("--shutdown-grace must be greater than zero")
	}

	cfg := webtui.Config{
		Bind:          webTUIBind,
		Port:          webTUIPort,
		MaxSessions:   webTUIMaxSessions,
		ShutdownGrace: webTUIShutdownGrace,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	fmt.Fprintf(cmd.OutOrStdout(), "Serving DefenseClaw web TUI on http://%s\n", cfg.Addr())
	return webtui.ListenAndServe(ctx, cfg)
}
