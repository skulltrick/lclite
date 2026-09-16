//go:build !windows

package main

import (
	"fmt"
	"os/exec"
	"strings"
	"syscall"
)

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
