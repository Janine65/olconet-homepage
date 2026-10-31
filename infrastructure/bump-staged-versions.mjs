// Pre-Commit-Hook: hebt die Patch-Version jedes Pakets an, dessen Ordner
// gestagte Aenderungen enthaelt. Eine im selben Commit bereits manuell
// geaenderte Version (z. B. Minor/Major) wird nicht angetastet.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Ungueltige Version: ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export function packagesWithChanges(stagedFiles, packageDirs) {
  return packageDirs.filter((dir) => stagedFiles.some((file) => file.startsWith(`${dir}/`)));
}

export function replaceVersion(packageJson, version) {
  const updated = packageJson.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`);
  if (JSON.parse(updated).version !== version) throw new Error('Version konnte nicht ersetzt werden');
  return updated;
}

function main() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('rev-parse', '--verify', 'HEAD');
  } catch {
    return; // Erster Commit: keine Basisversion vorhanden.
  }
  try {
    git('rev-parse', '--verify', '--quiet', 'MERGE_HEAD');
    return; // Merge-Commits nicht automatisch anheben.
  } catch {
    // Kein Merge: normal fortfahren.
  }
  const staged = git('diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean);
  const dirs = [...new Set(staged.filter((file) => file.startsWith('apps/')).map((file) => file.split('/').slice(0, 2).join('/')))];
  for (const dir of packagesWithChanges(staged, dirs)) {
    const manifest = `${dir}/package.json`;
    let headVersion;
    try {
      headVersion = JSON.parse(git('show', `HEAD:${manifest}`)).version;
    } catch {
      continue; // Neues Paket: Version aus package.json gilt unveraendert.
    }
    const stagedVersion = JSON.parse(git('show', `:${manifest}`)).version;
    const workingCopy = readFileSync(manifest, 'utf8');
    if (stagedVersion !== headVersion || JSON.parse(workingCopy).version !== headVersion) {
      continue; // Manuell angepasste Version respektieren.
    }
    const next = bumpPatch(headVersion);
    writeFileSync(manifest, replaceVersion(workingCopy, next));
    git('add', manifest);
    console.log(`${dir}: ${headVersion} -> ${next}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
