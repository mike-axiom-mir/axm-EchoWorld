function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(sortObject(value));
}

function receiptOrder(a, b) {
  return `${a.specialistId ?? ''}|${a.runId ?? ''}`.localeCompare(`${b.specialistId ?? ''}|${b.runId ?? ''}`);
}

export function mergeSpecialistProposals(world, receipts) {
  const ordered = [...receipts].sort(receiptOrder);
  const rejected = [];
  const eligible = [];

  for (const receipt of ordered) {
    if (receipt.baseRevision !== world.revision) {
      rejected.push({
        runId: receipt.runId,
        specialistId: receipt.specialistId,
        reason: 'STALE_BASE_REVISION',
        baseRevision: receipt.baseRevision,
        currentRevision: world.revision,
      });
      continue;
    }
    if (receipt.status !== 'PROPOSED') {
      rejected.push({
        runId: receipt.runId,
        specialistId: receipt.specialistId,
        reason: 'NOT_PROPOSED',
      });
      continue;
    }
    eligible.push(receipt);
  }

  const groups = new Map();
  for (const receipt of eligible) {
    const targetKey = receipt.proposal?.targetKey ?? `advisory:${receipt.runId}`;
    const group = groups.get(targetKey) ?? [];
    group.push(receipt);
    groups.set(targetKey, group);
  }

  const decisions = [];
  const conflicts = [];
  for (const targetKey of [...groups.keys()].sort()) {
    const group = groups.get(targetKey).sort(receiptOrder);
    const variants = new Map();
    for (const receipt of group) {
      const key = stableJson(receipt.proposal);
      const bucket = variants.get(key) ?? [];
      bucket.push(receipt);
      variants.set(key, bucket);
    }

    if (variants.size > 1) {
      const contradiction = {
        targetKey,
        runIds: group.map((item) => item.runId),
        proposals: [...variants.keys()].sort().map((key) => JSON.parse(key)),
      };
      conflicts.push(contradiction);
      decisions.push({
        targetKey,
        status: 'CONFLICT_REJECTED',
        selected: null,
        runIds: contradiction.runIds,
      });
      continue;
    }

    decisions.push({
      targetKey,
      status: 'PROPOSAL_ACCEPTED_FOR_GATE',
      selected: group[0].proposal,
      runIds: group.map((item) => item.runId),
    });
  }

  const mergeReceipt = {
    schema: 'axm.echoworld.specialist-merge-receipt/v0.01',
    baseRevision: world.revision,
    decisions,
    conflicts,
    rejected,
    canonicalMutationApplied: false,
  };
  world.receipts.specialistMerges.push(mergeReceipt);
  return mergeReceipt;
}
