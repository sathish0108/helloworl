/**
 * PM2 Management API (All routes use :id)
 * CommonJS version.
 *
 * Features:
 * - GET  /pm2/status/:id      -> use "all" to list all processes or a specific id/name
 * - GET  /pm2/describe/:id
 * - POST /pm2/restart/:id
 * - POST /pm2/stop/:id
 * - POST /pm2/start/:id      -> starts a process by name (id param as name) OR requires { "script": "/path/to/script" }
 * - GET  /pm2/logs/:id
 * - POST /pm2/update/:id     -> git pull in pm_cwd and restart
 *
 * Run: pm2 start pm2-control.js --name pm2-api
 */

const express = require("express");
const pm2 = require("pm2");
const bodyParser = require("body-parser");
const cors = require("cors");
const dotenv = require("dotenv");
const { exec } = require("child_process");

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Simple auth middleware: set ADMIN_KEY in .env
app.use((req, res, next) => {
  const key = req.headers["x-api-key"] || req.query.api_key;
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: "Forbidden: Invalid or missing API key" });
  }
  next();
});

// Debugging middleware — logs method+url
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// PM2 connect/disconnect helpers
const connectPM2 = () =>
  new Promise((resolve, reject) => {
    pm2.connect((err) => (err ? reject(err) : resolve()));
  });
const disconnectPM2 = () => pm2.disconnect();

// Health check
app.get("/pm2/health/:id", (req, res) => {
  res.json({ ok: true, id: req.params.id });
});

/**
 * STATUS
 * GET /pm2/status/:id
 * - :id = all  => returns all processes
 * - :id = number or name => returns single process info
 */
app.get("/pm2/status/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await connectPM2();
    pm2.list((err, list) => {
      disconnectPM2();
      if (err) return res.status(500).json({ error: err.message });

      if (id === "all") {
        const formatted = list.map((p) => ({
          id: p.pm_id,
          name: p.name,
          pid: p.pid,
          status: p.pm2_env.status,
          cwd: p.pm2_env.pm_cwd,
          uptime_seconds: p.pm2_env.pm_uptime ? Math.floor((Date.now() - p.pm2_env.pm_uptime) / 1000) : 0,
          restarts: p.pm2_env.restart_time,
        }));
        return res.json({ count: formatted.length, processes: formatted });
      }

      // find either by pm_id or name (string)
      const found = list.find((p) => String(p.pm_id) === String(id) || p.name === id);
      if (!found) return res.status(404).json({ error: `Process '${id}' not found` });
      return res.json({
        id: found.pm_id,
        name: found.name,
        pid: found.pid,
        status: found.pm2_env.status,
        cwd: found.pm2_env.pm_cwd,
        restarts: found.pm2_env.restart_time,
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DESCRIBE
 * GET /pm2/describe/:id
 */
app.get("/pm2/describe/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await connectPM2();
    pm2.describe(id, (err, desc) => {
      disconnectPM2();
      if (err) return res.status(500).json({ error: err.message });
      if (!desc || !desc.length) return res.status(404).json({ error: `Process '${id}' not found` });
      res.json(desc[0]);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * RESTART
 * POST /pm2/restart/:id
 */
app.post("/pm2/restart/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await connectPM2();
    pm2.describe(id, (dErr, desc) => {
      if (dErr || !desc || !desc.length) {
        disconnectPM2();
        return res.status(404).json({ error: `Process '${id}' not found` });
      }
      const proc = desc[0];
      pm2.restart(id, (err) => {
        disconnectPM2();
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: `Process '${proc.name}' restarted`, id: proc.pm_id, name: proc.name });
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * STOP
 * POST /pm2/stop/:id
 */
app.post("/pm2/stop/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await connectPM2();
    pm2.stop(id, (err, proc) => {
      disconnectPM2();
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: `Process '${id}' stopped` });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * START
 * POST /pm2/start/:id
 * - If body contains { "script": "/full/path/server.js", "args": "...", "cwd": "/abs/path" } it will start that script with provided name = :id
 * - Otherwise, it will try pm2.start({ name: id }) which requires a saved config or will fail.
 */
app.post("/pm2/start/:id", async (req, res) => {
  const { id } = req.params; // use as name
  const { script, args, cwd, exec_mode, instances } = req.body || {};

  try {
    await connectPM2();

    if (!script) {
      // attempt to start by name only (may fail if no config)
      pm2.start({ name: id }, (err, proc) => {
        disconnectPM2();
        if (err)
          return res.status(400).json({ error: "Missing script; and starting by name failed", details: err.message });
        return res.json({ message: `Process '${id}' started`, proc });
      });
      return;
    }

    const startOpts = {
      name: id,
      script,
      args: args || "",
      cwd: cwd || undefined,
      exec_mode: exec_mode || "fork",
      instances: instances || 1,
    };

    pm2.start(startOpts, (err, proc) => {
      disconnectPM2();
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: `Process '${id}' started with script`, proc });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * LOGS
 * GET /pm2/logs/:id
 */
app.get("/pm2/logs/:id", async (req, res) => {
  const { id } = req.params;
  const lines = parseInt(req.query.lines || "30", 10);
  exec(`pm2 logs ${id} --lines ${lines} --nostream`, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.setHeader("Content-Type", "text/plain");
    res.send(stdout);
  });
});

/**
 * UPDATE (git pull + restart)
 * POST /pm2/update/:id
 * - will detect pm_cwd from pm2 and run: git stash && git pull
 */
app.post("/pm2/update/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await connectPM2();
    pm2.describe(id, (dErr, desc) => {
      if (dErr || !desc || !desc.length) {
        disconnectPM2();
        return res.status(404).json({ error: `Process '${id}' not found` });
      }

      const proc = desc[0];
      const cwd = proc.pm2_env && proc.pm2_env.pm_cwd;
      if (!cwd) {
        disconnectPM2();
        return res.status(400).json({ error: "Cannot determine working directory (pm_cwd) for process" });
      }

      // stash local changes and pull (non-interactive)
      exec(`cd ${cwd} && git stash --include-untracked && git pull`, (gitErr, gitOut, gitErrOut) => {
        if (gitErr) {
          disconnectPM2();
          return res.status(500).json({ error: gitErrOut || gitErr.message });
        }

        // restart
        pm2.restart(id, (rErr) => {
          disconnectPM2();
          if (rErr) {
            return res.status(500).json({ error: rErr.message, git_output: gitOut });
          }

          // tail small logs
          exec(`pm2 logs ${id} --lines 10 --nostream`, (logErr, stdout) => {
            const logs = logErr ? `Could not fetch logs: ${logErr.message}` : stdout;
            res.json({
              message: `Updated and restarted '${proc.name}'`,
              cwd,
              git_output: gitOut.trim(),
              logs: logs.trim(),
            });
          });
        });
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 9000;
app.listen(PORT, () => console.log(`PM2 Control API running on port ${PORT}`));
