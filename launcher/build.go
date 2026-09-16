//go:build ignore

package main

// build.go is a convenience wrapper: `go run build.go` builds every platform we
// ship into dist/. It exists so the build steps are visible in the repo instead
// of living in a shell script nobody reads.
//
// Usage:
//   go run build.go            # all targets
//   go run build.go windows    # just one GOOS

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type target struct {
	goos   string
	goarch string
	ext    string
}

var targets = []target{
	{"windows", "amd64", ".exe"},
	{"windows", "arm64", ".exe"},
	{"linux", "amd64", ""},
	{"linux", "arm64", ""},
	{"darwin", "arm64", ""},
	{"darwin", "amd64", ""},
}

func main() {
	only := ""
	if len(os.Args) > 1 {
		only = os.Args[1]
	}
	out := "dist"
	if err := os.MkdirAll(out, 0o755); err != nil {
		fatal(err)
	}
	built := 0
	for _, t := range targets {
		if only != "" && t.goos != only {
			continue
		}
		name := fmt.Sprintf("LCLite-%s-%s%s", t.goos, t.goarch, t.ext)
		dest := filepath.Join(out, name)
		cmd := exec.Command("go", "build", "-trimpath", "-ldflags=-s -w", "-o", dest, ".")
		cmd.Env = append(os.Environ(), "GOOS="+t.goos, "GOARCH="+t.goarch, "CGO_ENABLED=0")
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if err := cmd.Run(); err != nil {
			fatal(fmt.Errorf("%s: %w", name, err))
		}
		st, err := os.Stat(dest)
		if err != nil {
			fatal(err)
		}
		fmt.Printf("  %-28s %5.1f MB\n", name, float64(st.Size())/1024/1024)
		built++
	}
	if built == 0 {
		fatal(fmt.Errorf("no target matched %q", only))
	}
	fmt.Printf("built %d binaries in %s\n", built, strings.TrimSuffix(out, "/"))
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "build failed:", err)
	os.Exit(1)
}
