import { exec } from "node:child_process";

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function versionParts(version: string): number[] {
  return version
    .replace(/^v/, "")
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function isNewerVersion(current: string, latest: string): boolean {
  const a = versionParts(current);
  const b = versionParts(latest);
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) !== (a[i] ?? 0)) return (b[i] ?? 0) > (a[i] ?? 0);
  }
  return false;
}

export function latestPublishedVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    exec(`${npmCommand()} view codeshark-cli version --json`, { timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const version = stdout.trim().replace(/^\"|\"$/g, "");
      resolve(/^\d+\.\d+\.\d+$/.test(version) ? version : null);
    });
  });
}

export async function installLatestVersion(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    exec(`${npmCommand()} install --global codeshark-cli@latest`, { timeout: 120_000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || stdout || error.message).trim()));
        return;
      }
      resolve();
    });
  });
}
