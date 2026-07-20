import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SKILL_MD } from './skillContent.js';

export function resolveSkillTargetDir(args: string[], cwd: string, homedir: string): string {
  const scopeDir = args.includes('--project') ? cwd : homedir;
  return path.join(scopeDir, '.claude', 'skills', 'goaltracker');
}

export function writeSkill(targetDir: string): string {
  mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, 'SKILL.md');
  writeFileSync(targetPath, SKILL_MD);
  return targetPath;
}

export function installSkill(args: string[] = []): string {
  const targetDir = resolveSkillTargetDir(args, process.cwd(), os.homedir());
  return writeSkill(targetDir);
}
