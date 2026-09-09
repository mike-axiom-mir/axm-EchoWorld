(() => {
  'use strict';

  const payload = window.__ECHOWORLD_DEMO__;
  if (!payload?.frames?.length) throw new Error('Missing EchoWorld observer payload.');

  const $ = (id) => document.getElementById(id);
  const elements = Object.fromEntries([
    'authority-copy', 'revision', 'world-hash', 'memory-toggle', 'world-grid',
    'step-count', 'step-dots', 'event-kicker', 'event-title', 'event-intent',
    'event-input', 'outcome-card', 'outcome-icon', 'outcome-title', 'outcome-copy',
    'flow-input', 'flow-truth', 'flow-observation', 'truth-count', 'observed-count',
    'memory-count', 'queue-count', 'evidence-list', 'previous', 'play', 'play-icon',
    'play-label', 'next', 'invariance-status', 'announcer',
  ].map((id) => [id, $(id)]));

  const state = { index: 0, memoryVisible: true, timer: null };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  elements['authority-copy'].textContent = payload.authorityBoundary;

  function shortHash(hash) {
    return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
  }

  function describeInput(input) {
    if (!input) return 'None';
    if (input.type === 'MOVE') return `${input.actorId} → (${input.x}, ${input.y})`;
    if (input.type === 'DAMAGE_STRUCTURE') return `${input.cellId} −${input.amount} integrity`;
    if (input.type === 'FIRE') return `${input.cellId} burning = true`;
    return input.type;
  }

  function cellLabel(cell, frame) {
    const parts = [`Cell ${cell.x}, ${cell.y}`, cell.material];
    if (cell.occupants.length) parts.push(`actor ${cell.occupants.join(', ')}`);
    if (cell.integrity != null) parts.push(`integrity ${cell.integrity}`);
    if (cell.burning) parts.push('burning');
    if (frame.outcome.affectedCellIds.includes(cell.cellId)) parts.push('canonical truth changed');
    if (frame.observation.depthByCell[cell.cellId] != null) parts.push(`observed at depth ${frame.observation.depthByCell[cell.cellId]}`);
    if (state.memoryVisible && cell.memoryCount) parts.push(`${cell.memoryCount} retained memory records`);
    return parts.join(', ');
  }

  function renderGrid(frame) {
    const fragment = document.createDocumentFragment();
    for (const cell of frame.world.cells) {
      const node = document.createElement('div');
      node.className = 'cell';
      node.dataset.cellId = cell.cellId;
      node.dataset.type = cell.type;
      node.dataset.material = cell.material;
      if (cell.burning) node.dataset.burning = 'true';
      if (frame.outcome.affectedCellIds.includes(cell.cellId)) node.dataset.truthChanged = 'true';
      const depth = frame.observation.depthByCell[cell.cellId];
      if (depth != null) {
        node.dataset.observed = 'true';
        node.style.setProperty('--depth', depth);
      }
      if (state.memoryVisible && cell.memoryCount) {
        node.dataset.memory = 'true';
        node.style.setProperty('--memory-weight', Math.min(cell.memoryCount, 8));
      }
      node.setAttribute('aria-label', cellLabel(cell, frame));
      node.title = cellLabel(cell, frame);

      if (cell.type === 'structure') {
        const structure = document.createElement('span');
        structure.className = 'structure';
        structure.setAttribute('aria-hidden', 'true');
        node.append(structure);
      }
      for (const actorId of cell.occupants) {
        const actor = document.createElement('span');
        actor.className = `actor actor-${actorId.toLowerCase()}`;
        actor.textContent = actorId;
        actor.setAttribute('aria-hidden', 'true');
        node.append(actor);
      }
      fragment.append(node);
    }
    elements['world-grid'].replaceChildren(fragment);
  }

  function renderDots() {
    const fragment = document.createDocumentFragment();
    payload.frames.forEach((_, index) => {
      const dot = document.createElement('span');
      dot.className = index === state.index ? 'active' : '';
      fragment.append(dot);
    });
    elements['step-dots'].replaceChildren(fragment);
  }

  function renderEvidence(frame) {
    const scheduler = frame.observation.scheduler;
    const pairs = [
      ['Canonical SHA-256', frame.world.canonicalHash],
      ['Affected cells', frame.outcome.affectedCellIds.join(', ') || 'None'],
      ['Truth receipt delta', String(frame.receipts.delta.truth)],
      ['Specialist proposals', String(frame.receipts.delta.specialists)],
      ['Perception receipts', String(frame.receipts.delta.perceptions)],
      ['Scheduler mutation', scheduler ? String(scheduler.canonicalMutationApplied) : 'Not run'],
      ['Scheduler hash witness', scheduler ? `${shortHash(scheduler.canonicalHashBefore)} = ${shortHash(scheduler.canonicalHashAfter)}` : 'Not run'],
    ];
    const fragment = document.createDocumentFragment();
    for (const [term, value] of pairs) {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = term;
      dd.textContent = value;
      fragment.append(dt, dd);
    }
    elements['evidence-list'].replaceChildren(fragment);
  }

  function render({ announce = false } = {}) {
    const frame = payload.frames[state.index];
    const isInitial = frame.event == null;
    const outcome = frame.outcome;
    const committed = outcome.committed === true;
    const rejected = outcome.committed === false;
    const scheduler = frame.observation.scheduler;

    elements.revision.textContent = `Revision ${frame.world.revision}`;
    elements['world-hash'].textContent = shortHash(frame.world.canonicalHash);
    elements['world-hash'].title = frame.world.canonicalHash;
    elements['step-count'].textContent = `Step ${state.index} / ${payload.frames.length - 1}`;
    elements['event-kicker'].textContent = isInitial ? 'BEFORE INPUT' : committed ? 'COMMITTED INPUT' : 'REJECTED INPUT';
    elements['event-title'].textContent = isInitial ? 'The world is ready' : frame.event.title;
    elements['event-intent'].textContent = isInitial ? 'Two actors and one intact bridge exist in canonical state.' : frame.event.intent;
    elements['event-input'].textContent = isInitial ? 'No event submitted' : JSON.stringify(frame.event.input, null, 2);

    elements['outcome-card'].className = `outcome-card ${isInitial ? 'neutral' : committed ? 'committed' : 'rejected'}`;
    elements['outcome-icon'].textContent = isInitial ? '○' : committed ? '✓' : '×';
    elements['outcome-title'].textContent = isInitial ? 'Awaiting input' : committed ? `Committed as revision ${outcome.revision}` : `Rejected · ${outcome.reason}`;
    elements['outcome-copy'].textContent = isInitial
      ? 'Revision and hash are unchanged.'
      : committed
        ? `${outcome.affectedCellIds.length} canonical cell${outcome.affectedCellIds.length === 1 ? '' : 's'} changed before observation.`
        : 'No truth receipt, revision change, or memory write was created.';

    elements['flow-input'].textContent = isInitial ? 'None' : describeInput(frame.event.input);
    elements['flow-truth'].textContent = isInitial ? 'No merge' : committed ? `Revision ${outcome.revision}` : 'Gate rejected';
    elements['flow-observation'].textContent = scheduler ? `${frame.observation.perceivedCellIds.length} cells · ${scheduler.status}` : rejected ? 'Suppressed' : 'No handoff';
    elements['truth-count'].textContent = frame.receipts.delta.truth;
    elements['observed-count'].textContent = frame.observation.perceivedCellIds.length;
    elements['memory-count'].textContent = frame.receipts.delta.memory;
    elements['queue-count'].textContent = scheduler ? scheduler.maxQueueObserved : '—';

    elements.previous.disabled = state.index === 0;
    elements.next.disabled = state.index === payload.frames.length - 1;
    renderDots();
    renderGrid(frame);
    renderEvidence(frame);

    if (announce) {
      elements.announcer.textContent = `${elements['step-count'].textContent}. ${elements['event-title'].textContent}. ${elements['outcome-title'].textContent}.`;
    }
  }

  function stop() {
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
    elements['play-icon'].textContent = '▶';
    elements['play-label'].textContent = state.index === payload.frames.length - 1 ? 'Replay proof' : 'Play proof';
    elements.play.setAttribute('aria-pressed', 'false');
  }

  function goTo(index, { announce = true } = {}) {
    state.index = Math.max(0, Math.min(payload.frames.length - 1, index));
    render({ announce });
    if (state.index === payload.frames.length - 1 && state.timer) stop();
  }

  function play() {
    if (state.timer) return stop();
    if (state.index === payload.frames.length - 1) goTo(0, { announce: false });
    elements['play-icon'].textContent = 'Ⅱ';
    elements['play-label'].textContent = 'Pause proof';
    elements.play.setAttribute('aria-pressed', 'true');
    state.timer = window.setInterval(() => goTo(state.index + 1), reducedMotion ? 2200 : 1500);
  }

  function toggleMemory() {
    state.memoryVisible = !state.memoryVisible;
    elements['memory-toggle'].setAttribute('aria-pressed', String(state.memoryVisible));
    elements['memory-toggle'].querySelector('b').textContent = state.memoryVisible ? 'ON' : 'OFF';
    renderGrid(payload.frames[state.index]);
    elements.announcer.textContent = `Memory layer ${state.memoryVisible ? 'shown' : 'hidden'}. Canonical truth is unchanged.`;
  }

  elements.previous.addEventListener('click', () => { stop(); goTo(state.index - 1); });
  elements.next.addEventListener('click', () => { stop(); goTo(state.index + 1); });
  elements.play.addEventListener('click', play);
  elements['memory-toggle'].addEventListener('click', toggleMemory);

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('summary, button')) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); stop(); goTo(state.index - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); stop(); goTo(state.index + 1); }
    if (event.key === 'Home') { event.preventDefault(); stop(); goTo(0); }
    if (event.key === 'End') { event.preventDefault(); stop(); goTo(payload.frames.length - 1); }
    if (event.key === ' ') { event.preventDefault(); play(); }
    if (event.key.toLowerCase() === 'm') { event.preventDefault(); toggleMemory(); }
  });

  const matches = payload.truthComparison.filter((entry) => entry.equal).length;
  elements['invariance-status'].querySelector('strong').textContent = `${matches} / ${payload.truthComparison.length} hashes match`;
  elements['invariance-status'].classList.toggle('failed', matches !== payload.truthComparison.length);
  render();
})();
