// pm2 on Windows can't run "npm" as the script directly — npm.cmd is a
// batch wrapper, not JS, and pm2's default fork mode tries to require() it
// as a Node module. Pointing at each app's own local `next` binary (with
// interpreter: "node") sidesteps that entirely.
module.exports = {
  apps: [
    {
      name: "backend",
      cwd: "./backend",
      script: "./venv/Scripts/python.exe",
      args: "-m uvicorn app.main:app --host 127.0.0.1 --port 8000",
      interpreter: "none",
      watch: false,
    },
    {
      name: "staff",
      cwd: "./matatu-mms",
      script: "./node_modules/next/dist/bin/next",
      args: "dev",
      interpreter: "node",
      watch: false,
    },
    {
      name: "public",
      cwd: "./matatu-mms-public",
      script: "./node_modules/next/dist/bin/next",
      args: "dev -p 3001",
      interpreter: "node",
      watch: false,
    },
    {
      name: "ops",
      cwd: "./matatu-mms-ops",
      script: "./node_modules/next/dist/bin/next",
      args: "dev -p 3002",
      interpreter: "node",
      watch: false,
    },
  ],
};
