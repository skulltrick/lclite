package main

import "testing"

// The picker must never offer the branches in hiddenBranches, and must keep
// offering everything else upstream has (a hidden list that over-matches is
// worse than one that under-matches: the revision silently disappears).
func TestHiddenRevsAreFiltered(t *testing.T) {
	revs := []Rev{
		{Name: "289", Client: true, Engine: true, Content: true},
		{Name: "274", Client: true, Engine: true, Content: true},
		{Name: "500", Client: true},
		{Name: "225-custom", Client: true},
		{Name: "225-gpu", Client: true},
		{Name: "jaged", Client: true},
		{Name: "377-wip", Client: true},
		{Name: "377-node", Client: true},
	}
	got := map[string]bool{}
	for _, r := range visibleRevs(revs) {
		got[r.Name] = true
	}
	for _, want := range []string{"289", "274", "500"} {
		if !got[want] {
			t.Errorf("visibleRevs dropped %q, want it kept", want)
		}
	}
	for _, bad := range []string{"225-custom", "225-gpu", "jaged", "377-wip", "377-node"} {
		if got[bad] {
			t.Errorf("visibleRevs kept %q, want it hidden", bad)
		}
	}
}

// The offline fallback list is what a user with no GitHub access sees, so it
// must not resurrect a hidden branch either.
func TestFallbackRevsHaveNoHiddenBranches(t *testing.T) {
	if len(visibleRevs(fallbackRevs)) != len(fallbackRevs) {
		t.Fatalf("fallbackRevs contains a hidden branch: %v", fallbackRevs)
	}
	if pickRecommended(fallbackRevs, "") != "289" {
		t.Errorf("fallback recommendation = %q, want 289", pickRecommended(fallbackRevs, ""))
	}
}

// Hiding a branch must not change which revision is recommended.
func TestHiddenRevsDoNotAffectRecommendation(t *testing.T) {
	revs := []Rev{
		{Name: "289", Client: true, Engine: true, Content: true},
		{Name: "274", Client: true, Engine: true, Content: true},
		{Name: "jaged", Client: true},
		{Name: "500", Client: true},
	}
	if got := pickRecommended(visibleRevs(revs), ""); got != "289" {
		t.Errorf("recommended = %q, want 289", got)
	}
}
