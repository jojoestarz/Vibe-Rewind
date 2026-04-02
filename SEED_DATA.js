// SEED_DATA.js — paste into viewer.html script block as fallback demo data
// Used when fetch('/api/sessions') fails (no local server running)

const SEED_SESSION = {
  session: {
    id: "demo-session-a3f9",
    started_at: Date.now() - 2200000,
    ended_at: Date.now() - 100000,
    repo: "/projects/my-app",
    prompt_count: 8
  },
  prompts: [
    {
      id: 1, session_id: "demo-session-a3f9", seq: 1,
      text: '"build me a dashboard for tracking cursor agent sessions"',
      timestamp: Date.now() - 2200000,
      type: "directive", influence: 91, drift: 0, spec_coverage: 18,
      decision: "Dashboard for agent sessions established as the top-level product goal."
    },
    {
      id: 2, session_id: "demo-session-a3f9", seq: 2,
      text: '"make it show the files that were changed"',
      timestamp: Date.now() - 1900000,
      type: "refinement", influence: 44, drift: 15, spec_coverage: 31,
      decision: "File diff view added as a core feature of the dashboard."
    },
    {
      id: 3, session_id: "demo-session-a3f9", seq: 3,
      text: '"actually can you add a graph like the one we saw earlier"',
      timestamp: Date.now() - 1600000,
      type: "pivot", influence: 78, drift: 41, spec_coverage: 29,
      decision: "Graph-based view replaces tabular layout; original dashboard framing partially abandoned."
    },
    {
      id: 4, session_id: "demo-session-a3f9", seq: 4,
      text: '"make the nodes draggable"',
      timestamp: Date.now() - 1400000,
      type: "detail", influence: 29, drift: 44, spec_coverage: 33,
      decision: "None."
    },
    {
      id: 5, session_id: "demo-session-a3f9", seq: 5,
      text: '"add colour coding for different decision types"',
      timestamp: Date.now() - 1100000,
      type: "refinement", influence: 52, drift: 47, spec_coverage: 40,
      decision: "Type-based colour system introduced — purple/teal/coral/amber encoding."
    },
    {
      id: 6, session_id: "demo-session-a3f9", seq: 6,
      text: '"hmm can we also track which cursorrules triggered each one"',
      timestamp: Date.now() - 800000,
      type: "scope_creep", influence: 83, drift: 68, spec_coverage: 38,
      decision: "Rules-tracing subsystem scoped in — new feature not in original intent."
    },
    {
      id: 7, session_id: "demo-session-a3f9", seq: 7,
      text: '"nevermind the rules thing, just show the prompt that caused each decision"',
      timestamp: Date.now() - 500000,
      type: "reversal", influence: 95, drift: 55, spec_coverage: 52,
      decision: "Rules-tracing killed. Prompt-to-decision linking introduced as the core product concept."
    },
    {
      id: 8, session_id: "demo-session-a3f9", seq: 8,
      text: '"add a scrubber so we can replay the session from any point"',
      timestamp: Date.now() - 200000,
      type: "directive", influence: 71, drift: 52, spec_coverage: 74,
      decision: "Scrubber/replay metaphor established as the primary UX. Product identity crystallised."
    }
  ]
};
