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

package webtui

import (
	"reflect"
	"testing"
)

func TestDefaultTUICommandFor(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		exists bool
		want   []string
	}{
		{
			name:   "packaged CLI",
			exists: true,
			want:   []string{"/app/.venv/bin/defenseclaw", "tui"},
		},
		{
			name:   "path fallback",
			exists: false,
			want:   []string{"defenseclaw", "tui"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := defaultTUICommandFor("/app/.venv/bin/defenseclaw", func(string) bool { return tt.exists })
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("defaultTUICommandFor() = %q, want %q", got, tt.want)
			}
		})
	}
}
