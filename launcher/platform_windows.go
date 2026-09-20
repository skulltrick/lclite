//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"strings"
	"syscall"
)

// hideWindow starts the process without flashing a console window.
func hideWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= 0x08000000 // CREATE_NO_WINDOW
}

// killTree terminates a process and every child it spawned.
func killTree(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	pid := cmd.Process.Pid
	killer := exec.Command("taskkill", "/PID", fmt.Sprint(pid), "/T", "/F")
	hideWindow(killer)
	if out, err := killer.CombinedOutput(); err != nil {
		_ = cmd.Process.Kill()
		return fmt.Errorf("taskkill: %v (%s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// openBrowser hands a URL to the default browser.
func openBrowser(url string) error {
	cmd := exec.Command("cmd.exe", "/c", "start", "", url)
	return cmd.Start()
}

// openPath opens a FOLDER in the desktop's file manager.
//
// explorer.exe is the only dependency-free way to do this on Windows (ShellExecute
// would need cgo). It is deliberately fire-and-forget: explorer frequently exits
// with a non-zero status even when it opened the window, so the exit code says
// nothing about whether the folder appeared.
func openPath(path string) error {
	cmd := exec.Command("explorer.exe", path)
	hideWindow(cmd)
	return cmd.Start()
}

// pickFolder shows a native folder picker on the user's desktop.
func pickFolder(startDir string) (string, error) {
	script := `Add-Type -AssemblyName System.Windows.Forms | Out-Null; ` +
		`$d = New-Object System.Windows.Forms.FolderBrowserDialog; ` +
		`$d.Description = 'Pick a Lost City folder (the one holding webclient/ and engine/)'; ` +
		`$d.ShowNewFolderButton = $false; `
	if startDir != "" {
		script += fmt.Sprintf(`$d.SelectedPath = '%s'; `, strings.ReplaceAll(startDir, "'", "''"))
	}
	script += `if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-STA", "-Command", script)
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	path := strings.TrimSpace(string(out))
	if path == "" {
		return "", fmt.Errorf("no folder selected")
	}
	return path, nil
}

func npmExe() string { return "cmd.exe" }

func npmArgs(args ...string) []string {
	return append([]string{"/c", "npm"}, args...)
}
