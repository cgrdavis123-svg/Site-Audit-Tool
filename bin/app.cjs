// Entry point for hosting panels that load the "application startup file"
// with a synchronous require() rather than spawning `node <file>` — notably
// LiteSpeed's Node.js Selector (lsnode.js), and some Passenger configurations.
// This project is a native ES Module ("type": "module" in package.json), and
// Node refuses to require() an ES module (ERR_REQUIRE_ESM). Because this file
// itself has a .cjs extension, Node always treats it as CommonJS regardless
// of package.json — so require() succeeds — and it can still reach the real
// ESM code via dynamic import(), which is available from CommonJS.
//
// All configuration here comes from environment variables (PORT, HOST,
// DASHBOARD_TOKEN, SITE_AUDIT_REPORTS_DIR, SITE_AUDIT_DATA_FILE,
// SITE_AUDIT_CONCURRENCY, SITE_AUDIT_ALLOW_PRIVATE_TARGETS) since the host
// calls this file directly with no meaningful command-line arguments to
// parse. Use bin/serve.js instead when starting the dashboard by hand from a
// terminal with CLI flags.
import('../src/startDashboard.js')
  .then((mod) => mod.startDashboard())
  .catch((err) => {
    console.error('Failed to start Site Audit Dashboard:', err);
    process.exitCode = 1;
  });
