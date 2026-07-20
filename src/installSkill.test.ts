import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { resolveSkillTargetDir, writeSkill } from './installSkill.js';
import { SKILL_MD } from './skillContent.js';

describe('resolveSkillTargetDir', () => {
  it('resolves to the home directory by default (personal scope)', () => {
    const dir = resolveSkillTargetDir([], '/some/project', '/home/alice');
    expect(dir).toBe(path.join('/home/alice', '.claude', 'skills', 'goaltracker'));
  });

  it('resolves to the cwd with --project (project scope)', () => {
    const dir = resolveSkillTargetDir(['--project'], '/some/project', '/home/alice');
    expect(dir).toBe(path.join('/some/project', '.claude', 'skills', 'goaltracker'));
  });
});

describe('writeSkill', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('writes the exact SKILL_MD content to <targetDir>/SKILL.md, creating directories as needed', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'goaltracker-skill-'));
    const targetDir = path.join(dir, 'nested', '.claude', 'skills', 'goaltracker');
    const written = writeSkill(targetDir);

    expect(written).toBe(path.join(targetDir, 'SKILL.md'));
    expect(existsSync(written)).toBe(true);
    expect(readFileSync(written, 'utf-8')).toBe(SKILL_MD);
  });
});

describe('SKILL_MD (generated)', () => {
  it('round-trips the real skill source file exactly', () => {
    const sourcePath = path.join(process.cwd(), '.claude', 'skills', 'goaltracker', 'SKILL.md');
    const source = readFileSync(sourcePath, 'utf-8');
    expect(SKILL_MD).toBe(source);
  });
});
