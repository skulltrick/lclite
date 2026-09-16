//go:build ignore

package main

// build.go is a convenience wrapper: `go run build.go` builds every platform we
// ship into dist/. It exists so the build steps are visible in the repo instead
// of living in a shell script nobody reads.
//
// It also stamps the version (the release tag is the source of truth) and writes
// dist/SHA256SUMS.txt next to the binaries.
//
// Usage:
//   go run build.go                          # all targets, version "dev"
//   go run build.go -version v0.2.0          # stamp a release version
//   go run build.go windows -version v0.2.0  # just one GOOS
//
// The version can also come from the LCLITE_VERSION env var, which is what CI uses.

import (
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
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
	versionFlag := flag.String("version", "", "version to stamp, e.g. v0.2.0 (default: LCLITE_VERSION, else \"dev\")")
	flag.Parse()
	only := flag.Arg(0)

	version := strings.TrimPrefix(strings.TrimSpace(*versionFlag), "v")
	if version == "" {
		version = strings.TrimPrefix(strings.TrimSpace(os.Getenv("LCLITE_VERSION")), "v")
	}
	if version == "" {
		version = "dev"
	}

	out := "dist"
	if err := os.MkdirAll(out, 0o755); err != nil {
		fatal(err)
	}

	ldflags := "-s -w -X main.launcherVersion=" + version
	built := []string{}
	for _, t := range targets {
		if only != "" && t.goos != only {
			continue
		}
		name := fmt.Sprintf("LCLite-%s-%s%s", t.goos, t.goarch, t.ext)
		dest := filepath.Join(out, name)
		cmd := exec.Command("go", "build", "-trimpath", "-ldflags="+ldflags, "-o", dest, ".")
		cmd.Env = append(os.Environ(), "GOOS="+t.goos, "GOARCH="+t.goarch, "CGO_ENABLED=0")
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if err := cmd.Run(); err != nil {
			fatal(fmt.Errorf("%s: %w", name, err))
		}
		st, err := os.Stat(dest)
		if err != nil {
			fatal(err)
		}
		built = append(built, name)
		fmt.Printf("  %-28s %5.1f MB\n", name, float64(st.Size())/1024/1024)
	}
	if len(built) == 0 {
		fatal(fmt.Errorf("no target matched %q", only))
	}

	// checksums, so a download can be verified instead of taken on faith
	sums := &strings.Builder{}
	for _, name := range built {
		sum, err := sha256File(filepath.Join(out, name))
		if err != nil {
			fatal(err)
		}
		fmt.Fprintf(sums, "%s  %s\n", sum, name)
	}
	if err := os.WriteFile(filepath.Join(out, "SHA256SUMS.txt"), []byte(sums.String()), 0o644); err != nil {
		fatal(err)
	}

	fmt.Printf("built %d binaries in %s — version %s\n", len(built), strings.TrimSuffix(out, "/"), version)
	if version == "dev" {
		fmt.Println("note: no version stamped (pass -version vX.Y.Z) — `LCLite --version` will print \"dev\"")
	}
}

func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "build failed:", err)
	os.Exit(1)
}
