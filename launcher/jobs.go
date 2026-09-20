package main

import (
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type LogLine struct {
	N    int       `json:"n"`
	Text string    `json:"text"`
	At   time.Time `json:"at"`
}

type Job struct {
	mu        sync.Mutex
	ID        string
	Kind      string
	InstallID string
	Step      string
	Status    string // running | ok | failed
	Err       string
	Started   time.Time
	Ended     time.Time
	lines     []LogLine
	next      int
	// console is the launcher's one terminal: every job line is mirrored there too,
	// so the page shows an install in the same feed as the world it starts.
	console *Console
}

type JobManager struct {
	mu      sync.Mutex
	current *Job
	last    *Job
	console *Console
}

func newJobManager(console *Console) *JobManager { return &JobManager{console: console} }

func (m *JobManager) run(kind, installID string, fn func(*Job) error) *Job {
	j := &Job{ID: fmt.Sprintf("%s-%d", kind, time.Now().UnixNano()), Kind: kind, InstallID: installID, Status: "running", Started: time.Now(), console: m.console}
	m.mu.Lock()
	m.current = j
	m.last = j
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		if m.current == j {
			m.current = nil
		}
		m.mu.Unlock()
	}()

	err := fn(j)
	j.mu.Lock()
	defer j.mu.Unlock()
	j.Ended = time.Now()
	if err != nil {
		j.Status = "failed"
		j.Err = err.Error()
		j.appendLocked("!! " + err.Error())
	} else {
		j.Status = "ok"
	}
	return j
}

func (m *JobManager) active() *Job {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.current
}

// find returns a job by id, preferring the running one.
func (m *JobManager) find(id string) *Job {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.current != nil && (id == "" || m.current.ID == id) {
		return m.current
	}
	if m.last != nil && (id == "" || m.last.ID == id) {
		return m.last
	}
	return nil
}

func (j *Job) logf(format string, a ...any) {
	text := fmt.Sprintf(format, a...)
	j.mu.Lock()
	defer j.mu.Unlock()
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if line == "" {
			continue
		}
		j.appendLocked(line)
	}
	if len(j.lines) > 4000 {
		j.lines = append([]LogLine(nil), j.lines[len(j.lines)-2000:]...)
	}
}

// appendLocked adds one line to the job's own ring and mirrors it to the console.
// The caller holds j.mu — logf and the job's own end-of-run error both do — which
// is why this is not just logf.
func (j *Job) appendLocked(text string) {
	j.lines = append(j.lines, LogLine{N: j.next, Text: text, At: time.Now()})
	j.next++
	j.console.write("task", text)
}

func (j *Job) setStep(step string) {
	j.mu.Lock()
	j.Step = step
	j.mu.Unlock()
	j.logf("== %s", step)
}

type jobView struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	InstallID string    `json:"install_id"`
	Step      string    `json:"step"`
	Status    string    `json:"status"`
	Err       string    `json:"err"`
	Started   time.Time `json:"started"`
	Ended     time.Time `json:"ended"`
	Next      int       `json:"next"`
	Lines     []LogLine `json:"lines"`
}

func (j *Job) view(since int) jobView {
	j.mu.Lock()
	defer j.mu.Unlock()
	lines := make([]LogLine, 0, len(j.lines))
	for _, ln := range j.lines {
		if ln.N >= since {
			lines = append(lines, ln)
		}
	}
	if len(lines) > 2000 {
		lines = lines[len(lines)-2000:]
	}
	return jobView{
		ID: j.ID, Kind: j.Kind, InstallID: j.InstallID, Step: j.Step,
		Status: j.Status, Err: j.Err, Started: j.Started, Ended: j.Ended,
		Next: j.next, Lines: lines,
	}
}

// runCmd runs a program, streaming its output into the job log.
func (j *Job) runCmd(name string, args ...string) error {
	j.logf("$ %s %s", name, strings.Join(args, " "))
	cmd := exec.Command(name, args...)
	hideWindow(cmd)
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		return err
	}
	buf := make([]byte, 32*1024)
	carry := ""
	for {
		n, rerr := pipe.Read(buf)
		if n > 0 {
			carry += string(buf[:n])
			for {
				i := strings.IndexAny(carry, "\r\n")
				if i < 0 {
					break
				}
				line := carry[:i]
				carry = carry[i+1:]
				if strings.TrimSpace(line) != "" {
					j.logf("%s", line)
				}
			}
			if len(carry) > 4096 {
				j.logf("%s", carry)
				carry = ""
			}
		}
		if rerr != nil {
			break
		}
	}
	if strings.TrimSpace(carry) != "" {
		j.logf("%s", carry)
	}
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("%s failed: %v", name, err)
	}
	return nil
}

// runCmdIn runs a program inside a working directory.
func (j *Job) runCmdIn(dir, name string, args ...string) error {
	j.logf("$ (in %s) %s %s", filepathBase(dir), name, strings.Join(args, " "))
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	hideWindow(cmd)
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		return err
	}
	buf := make([]byte, 32*1024)
	carry := ""
	for {
		n, rerr := pipe.Read(buf)
		if n > 0 {
			carry += string(buf[:n])
			for {
				i := strings.IndexAny(carry, "\r\n")
				if i < 0 {
					break
				}
				line := carry[:i]
				carry = carry[i+1:]
				if strings.TrimSpace(line) != "" {
					j.logf("%s", line)
				}
			}
		}
		if rerr != nil {
			break
		}
	}
	if strings.TrimSpace(carry) != "" {
		j.logf("%s", carry)
	}
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("%s failed: %v", name, err)
	}
	return nil
}

func filepathBase(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
}
