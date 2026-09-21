//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
)

// appWindowCandidates lists the browsers that can open a chromeless app window, in
// the order we would rather have them: the macOS bundles first (that is where a Mac
// keeps them), then whatever the PATH offers.
func appWindowCandidates() []string {
	var out []string
	if runtime.GOOS == "darwin" {
		bases := []string{"/Applications"}
		if home := os.Getenv("HOME"); home != "" {
			bases = append(bases, filepath.Join(home, "Applications"))
		}
		for _, app := range []string{"Microsoft Edge", "Google Chrome", "Chromium", "Brave Browser"} {
			for _, base := range bases {
				out = append(out, filepath.Join(base, app+".app", "Contents", "MacOS", app))
			}
		}
	}
	for _, name := range []string{
		"microsoft-edge", "microsoft-edge-stable",
		"google-chrome", "google-chrome-stable",
		"chromium", "chromium-browser",
		"brave-browser", "vivaldi",
	} {
		if p, err := exec.LookPath(name); err == nil {
			out = append(out, p)
		}
	}
	return out
}

// hideWindow puts the child in its own process group so it can be killed with
// its children later; there is no console flash to suppress off Windows.
func hideWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}

// killTree terminates a process group.
func killTree(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	pid := cmd.Process.Pid
	if err := syscall.Kill(-pid, syscall.SIGTERM); err != nil {
		if err := cmd.Process.Kill(); err != nil {
			return fmt.Errorf("kill: %v", err)
		}
	}
	return nil
}

// openBrowser hands a URL to the desktop browser.
func openBrowser(url string) error {
	for _, opener := range []string{"xdg-open", "open"} {
		if p, err := exec.LookPath(opener); err == nil {
			return exec.Command(p, url).Start()
		}
	}
	return fmt.Errorf("no browser opener found (install xdg-open)")
}

// openPath opens a FOLDER in the desktop's file manager (xdg-open handles
// directories, and macOS's `open` does too).
func openPath(path string) error {
	for _, opener := range []string{"xdg-open", "open"} {
		if p, err := exec.LookPath(opener); err == nil {
			return exec.Command(p, path).Start()
		}
	}
	return fmt.Errorf("no file manager opener found (install xdg-open)")
}

// pickFolder shows a native folder picker when one of the usual helpers exists.
func pickFolder(startDir string) (string, error) {
	if p, err := exec.LookPath("zenity"); err == nil {
		out, err := exec.Command(p, "--file-selection", "--directory", "--title=Pick a Lost City folder").Output()
		if err != nil {
			return "", err
		}
		return strings.TrimSpace(string(out)), nil
	}
	if p, err := exec.LookPath("kdialog"); err == nil {
		out, err := exec.Command(p, "--getexistingdirectory", startDir).Output()
		if err != nil {
			return "", err
		}
		return strings.TrimSpace(string(out)), nil
	}
	return "", fmt.Errorf("no folder picker available — type the path instead")
}

func npmExe() string { return "npm" }

func npmArgs(args ...string) []string { return args }
