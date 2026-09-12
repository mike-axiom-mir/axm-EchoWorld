import { readFile } from 'node:fs/promises';

import { atomicSnapshotPaths } from './atomic-types.js';
import { validateAtomicSnapshotText } from './snapshot-envelope.js';

const ROLE_PRIORITY = Object.freeze({ primary: 0, temp: 1, recoveryTemp: 2, backup: 3 });

export async function readSnapshotCandidate(role, filePath) {
  try {
    const text = await readFile(filePath, 'utf8');
    return {
      role,
      path: filePath,
      exists: true,
      text,
      policyEligible: true,
      policyReason: null,
      policyDetails: {},
      ...validateAtomicSnapshotText(text),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        role,
        path: filePath,
        exists: false,
        text: null,
        valid: false,
        reason: 'FILE_MISSING',
        details: {},
        envelope: null,
        world: null,
        policyEligible: false,
        policyReason: 'FILE_MISSING',
        policyDetails: {},
      };
    }
    return {
      role,
      path: filePath,
      exists: true,
      text: null,
      valid: false,
      reason: 'FILE_READ_FAILED',
      details: { code: error?.code ?? null, message: error.message },
      envelope: null,
      world: null,
      policyEligible: false,
      policyReason: 'FILE_READ_FAILED',
      policyDetails: {},
    };
  }
}

export function snapshotCandidateSummary(candidate) {
  return {
    role: candidate.role,
    path: candidate.path,
    exists: candidate.exists,
    valid: candidate.valid,
    reason: candidate.reason,
    policyEligible: candidate.policyEligible,
    policyReason: candidate.policyReason,
    policyDetails: candidate.policyDetails,
    generation: candidate.envelope?.generation ?? null,
    snapshotId: candidate.envelope?.snapshotId ?? null,
    canonicalHash: candidate.envelope?.canonicalHash ?? null,
    payloadHash: candidate.envelope?.payloadHash ?? null,
    checkpointId: candidate.envelope?.checkpoint?.checkpointId ?? null,
    fencingToken: candidate.envelope?.checkpoint?.fencingToken ?? null,
    writerId: candidate.envelope?.checkpoint?.writerId ?? null,
  };
}

function selectCandidate(candidates) {
  const valid = candidates.filter((candidate) => candidate.valid && candidate.policyEligible);
  if (valid.length === 0) return { selected: null, conflict: null };

  const generation = Math.max(...valid.map((candidate) => candidate.envelope.generation));
  const highest = valid.filter((candidate) => candidate.envelope.generation === generation);
  const snapshotIds = new Set(highest.map((candidate) => candidate.envelope.snapshotId));
  if (snapshotIds.size > 1) {
    return {
      selected: null,
      conflict: { generation, candidates: highest.map(snapshotCandidateSummary) },
    };
  }

  highest.sort((a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]);
  return { selected: highest[0], conflict: null };
}

export async function inspectAtomicSnapshotStore({
  directory,
  name = 'world',
  candidatePolicy = null,
}) {
  const paths = atomicSnapshotPaths(directory, name);
  const candidates = await Promise.all([
    readSnapshotCandidate('primary', paths.primary),
    readSnapshotCandidate('backup', paths.backup),
    readSnapshotCandidate('temp', paths.temp),
    readSnapshotCandidate('recoveryTemp', paths.recoveryTemp),
  ]);

  if (candidatePolicy) {
    for (const candidate of candidates) {
      if (!candidate.valid) continue;
      const policy = await candidatePolicy(candidate);
      candidate.policyEligible = policy?.eligible !== false;
      candidate.policyReason = policy?.reason ?? null;
      candidate.policyDetails = policy?.details ?? {};
    }
  }

  const { selected, conflict } = selectCandidate(candidates);
  return {
    schema: 'axm.echoworld.atomic-snapshot-inspection/v0.02',
    directory,
    name,
    paths,
    candidates,
    candidateSummaries: candidates.map(snapshotCandidateSummary),
    selected,
    selectedSummary: selected ? snapshotCandidateSummary(selected) : null,
    conflict,
    anyExisting: candidates.some((candidate) => candidate.exists),
    anyValid: candidates.some((candidate) => candidate.valid),
    anyEligibleValid: candidates.some((candidate) => candidate.valid && candidate.policyEligible),
  };
}
