import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const manifests = [
  "package.json",
  "apps/client/package.json",
  "apps/server/package.json",
  "packages/shared/package.json",
];
const stampPath = resolve(root, "node_modules/.animal-care-deps");
const vitePath = resolve(root, "node_modules/.bin", process.platform === "win32" ? "vite.cmd" : "vite");

function dependencyFingerprint() {
  const hash = createHash("sha256");
  for (const path of manifests) hash.update(readFileSync(resolve(root, path)));
  return hash.digest("hex");
}

function runNpm(args) {
  const isWindows = process.platform === "win32";
  const command = isWindows ? (process.env.ComSpec || "cmd.exe") : "npm";
  const commandArgs = isWindows
    ? ["/d", "/s", "/c", "npm", ...args]
    : args;

  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const fingerprint = dependencyFingerprint();
const installedFingerprint = existsSync(stampPath) ? readFileSync(stampPath, "utf8").trim() : "";
const needsInstall = !existsSync(vitePath) || installedFingerprint !== fingerprint;

console.log("\nAnimal Care Co-op — local launcher\n");

if (needsInstall) {
  console.log("[setup] Pierwszy start albo zmiana zależności — uruchamiam npm install...");
  runNpm(["install"]);
  mkdirSync(dirname(stampPath), { recursive: true });
  writeFileSync(stampPath, fingerprint, "utf8");
  console.log("[setup] Gotowe. Kolejne uruchomienia pominą instalację.\n");
} else {
  console.log("[setup] Zależności są aktualne — pomijam npm install.\n");
}

console.log("[game] Uruchamiam klienta i otwieram przeglądarkę...\n");
runNpm(["run", "dev", "--", "--open"]);
