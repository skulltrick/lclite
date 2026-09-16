package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Tool is one external program the launcher can drive.
type Tool struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Version string `json:"version"`
	OK      bool   `json:"ok"`
	Hint    string `json:"hint"`
	Managed bool   `json:"managed"` // installed by the launcher itself
}

func runCapture(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	hideWindow(cmd)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		return s[:i]
	}
	if len(s) > 120 {
		return s[:120]
	}
	return s
}

func lookTool(name string, versionArgs []string, hint string) Tool {
	t := Tool{Name: name, Hint: hint}
	p, err := exec.LookPath(name)
	if err != nil {
		return t
	}
	t.Path = p
	t.OK = true
	if len(versionArgs) > 0 {
		if out, err := runCapture(p, versionArgs...); err == nil {
			t.Version = firstLine(out)
		}
	}
	return t
}

func (l *Launcher) detectTools() []Tool {
	tools := []Tool{
		lookTool("git", []string{"--version"}, "https://git-scm.com/downloads"),
		lookTool("node", []string{"--version"}, "https://nodejs.org (the engine needs node 24+)"),
		lookTool("npm", nil, "ships with node"),
	}
	bun := l.findBun()
	if bun != "" {
		t := Tool{Name: "bun", Path: bun, OK: true}
		if out, err := runCapture(bun, "--version"); err == nil {
			t.Version = "bun " + firstLine(out)
		}
		t.Managed = strings.Contains(bun, filepath.Join(l.dataDir, "tools"))
		tools = append(tools, t)
	} else {
		tools = append(tools, Tool{
			Name: "bun",
			Hint: "needed to build the webclient bundle — the launcher can fetch it",
		})
	}
	return tools
}

func (l *Launcher) findBun() string {
	if p, err := exec.LookPath("bun"); err == nil {
		return p
	}
	name := "bun"
	if runtime.GOOS == "windows" {
		name = "bun.exe"
	}
	for _, cand := range []string{
		filepath.Join(l.dataDir, "tools", "bun", name),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Temp", "bunx", "bun-windows-x64", name),
	} {
		if st, err := os.Stat(cand); err == nil && !st.IsDir() {
			return cand
		}
	}
	return ""
}

// ensureBun installs a private copy of bun under <data>/tools/bun when missing.
func (l *Launcher) ensureBun(log func(string, ...any)) (string, error) {
	if p := l.findBun(); p != "" {
		return p, nil
	}
	if runtime.GOOS != "windows" {
		return "", fmt.Errorf("bun not found — install it from https://bun.sh and retry")
	}
	log("bun not found — downloading a private copy (~35 MB, one time)")
	url := "https://github.com/oven-sh/bun/releases/latest/download/bun-windows-x64.zip"
	dir := filepath.Join(l.dataDir, "tools", "bun")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	zipPath := filepath.Join(dir, "bun.zip")
	if err := download(url, zipPath, log); err != nil {
		return "", err
	}
	log("extracting bun…")
	exe, err := unzipFind(zipPath, dir, "bun.exe")
	if err != nil {
		return "", err
	}
	_ = os.Remove(zipPath)
	log("bun ready: %s", exe)
	return exe, nil
}

func download(url, dest string, log func(string, ...any)) error {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "lclite-launcher")
	cl := &http.Client{Timeout: 15 * time.Minute}
	res, err := cl.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("download failed: %s", res.Status)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	total := res.ContentLength
	done := int64(0)
	last := time.Now()
	buf := make([]byte, 512*1024)
	for {
		n, err := res.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				return werr
			}
			done += int64(n)
			if time.Since(last) > 3*time.Second {
				if total > 0 {
					log("  … %d%% of %d MB", done*100/total, total/1024/1024)
				} else {
					log("  … %d MB", done/1024/1024)
				}
				last = time.Now()
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func unzipFind(archivePath, destDir, want string) (string, error) {
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return "", err
	}
	defer r.Close()
	found := ""
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := filepath.Base(f.Name)
		if strings.EqualFold(name, want) {
			rc, err := f.Open()
			if err != nil {
				return "", err
			}
			target := filepath.Join(destDir, name)
			out, err := os.Create(target)
			if err != nil {
				rc.Close()
				return "", err
			}
			if _, err := io.Copy(out, rc); err != nil {
				out.Close()
				rc.Close()
				return "", err
			}
			out.Close()
			rc.Close()
			found = target
		}
	}
	if found == "" {
		return "", fmt.Errorf("%s not found inside %s", want, filepath.Base(archivePath))
	}
	return found, nil
}

// readJSONFile is a tolerant reader used for world.json and the like.
func readJSONFile(path string) (map[string]any, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	return m, nil
}
