package main

import (
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Proxy is the RSProx-style bridge: the webclient talks to window.location.host,
// so anything on the other end of this listener is "the server" as far as the
// client is concerned. Pointing it at a remote Lost City server lets a locally
// built (modded) client play there, and lets a remote server be reached over a
// friendly localhost address.
type Proxy struct {
	mu        sync.Mutex
	ln        net.Listener
	srv       *http.Server
	target    *url.URL
	localRoot string
	useLocal  bool
	port      int
	log       LogRing
}

func (p *Proxy) Running() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.srv != nil
}

func (p *Proxy) Status() map[string]any {
	p.mu.Lock()
	defer p.mu.Unlock()
	st := map[string]any{"running": p.srv != nil, "port": p.port, "local_client": p.useLocal}
	if p.target != nil {
		st["target"] = p.target.String()
		st["url"] = fmt.Sprintf("http://localhost%s/rs2.cgi", portSuffix(p.port))
	}
	return st
}

// StartProxy bridges localPort -> targetURL, optionally serving the install's
// built client bundle (/client/*, /lclite/*) instead of the remote's.
func (l *Launcher) StartProxy(targetURL string, port int, localClient bool, in *Install) error {
	if l.proxy.Running() {
		return fmt.Errorf("the proxy is already running — stop it first")
	}
	if !strings.HasPrefix(targetURL, "http://") && !strings.HasPrefix(targetURL, "https://") {
		targetURL = "http://" + targetURL
	}
	target, err := url.Parse(targetURL)
	if err != nil || target.Host == "" {
		return fmt.Errorf("that does not look like a server address: %q", targetURL)
	}
	if port <= 0 {
		port = 8890
	}
	if !portFree(port) {
		return fmt.Errorf("port %d is already in use — pick another proxy port", port)
	}

	p := &Proxy{target: target, port: port, useLocal: localClient}
	if in != nil {
		p.localRoot = in.publicDir()
	}
	p.log.reset()

	rp := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = target.Host
			if req.Header.Get("Origin") != "" {
				req.Header.Set("Origin", target.Scheme+"://"+target.Host)
			}
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			p.log.logf("!! %s %s: %v", r.Method, r.URL.Path, err)
			http.Error(w, "proxy error: "+err.Error(), http.StatusBadGateway)
		},
		FlushInterval: 100 * time.Millisecond,
	}

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p.useLocal && p.localRoot != "" && serveLocalAsset(p.localRoot, w, r) {
			return
		}
		p.log.logf("%s %s%s", r.Method, target.Host, r.URL.Path)
		rp.ServeHTTP(w, r)
	})

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return fmt.Errorf("could not listen on port %d: %v", port, err)
	}
	srv := &http.Server{Handler: handler}

	p.mu.Lock()
	p.ln = ln
	p.srv = srv
	l.proxy = p
	p.mu.Unlock()

	go func() {
		err := srv.Serve(ln)
		p.mu.Lock()
		p.srv = nil
		p.ln = nil
		p.mu.Unlock()
		if err != nil && err != http.ErrServerClosed {
			p.log.logf("!! proxy stopped: %v", err)
		}
	}()

	p.log.logf("bridging http://localhost%s -> %s", portSuffix(port), target.String())
	if p.useLocal {
		if p.localRoot == "" {
			p.log.logf("!! no local build to serve — pass through only")
		} else {
			p.log.logf("serving the local client bundle from %s", p.localRoot)
		}
	}
	return nil
}

func (l *Launcher) StopProxy() error {
	p := l.proxy
	if p == nil || !p.Running() {
		return fmt.Errorf("the proxy is not running")
	}
	p.mu.Lock()
	srv := p.srv
	p.mu.Unlock()
	p.log.logf("stopping proxy")
	return srv.Close()
}

// serveLocalAsset answers /client/* and /lclite/* from a local build when present.
func serveLocalAsset(root string, w http.ResponseWriter, r *http.Request) bool {
	path := r.URL.Path
	var rel string
	switch {
	case strings.HasPrefix(path, "/client/"):
		rel = filepath.Join("client", strings.TrimPrefix(path, "/client/"))
	case strings.HasPrefix(path, "/lclite/"):
		rel = filepath.Join("lclite", strings.TrimPrefix(path, "/lclite/"))
	default:
		return false
	}
	full := filepath.Join(root, filepath.FromSlash(rel))
	if !strings.HasPrefix(full, root) {
		return false
	}
	st, err := os.Stat(full)
	if err != nil || st.IsDir() {
		return false
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, full)
	return true
}
