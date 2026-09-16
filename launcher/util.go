package main

import "encoding/json"

// marshalIndent pretty-prints JSON with a trailing newline (config files).
func marshalIndent(v any) ([]byte, error) {
	raw, err := json.MarshalIndent(v, "", "    ")
	if err != nil {
		return nil, err
	}
	return append(raw, '\n'), nil
}
