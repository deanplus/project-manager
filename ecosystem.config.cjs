module.exports = {
  apps: [
    {
      name: "project-mgr-web",
      cwd: __dirname,
      script: process.execPath,
      interpreter: "none",
      args: [
        "--env-file-if-exists=.env",
        "dist/cli.js",
        "serve",
        "--host",
        "127.0.0.1",
        "--no-open",
      ],
      env: {
        PMGR_DB_PATH: `${process.env.HOME}/.local/share/project-mgr/project-mgr.sqlite`,
      },
    },
  ],
};
