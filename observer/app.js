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
    'play-label', 'next', 'invariance-status', 'announcer', 'cell-title',
    'cell-id', 'cell-summary', 'cell-evidence',
  ].map((id) => [id, $(id)]));

  const state = { index: 0, memoryVisible: true, timer: null, selectedCellId: 'C_2_1' };
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

  function selectedCell(frame) {
    return frame.world.cells.find((cell) => cell.cellId === state.selectedCellId) || frame.world.cells[0];
  }

  function renderCellInspector(frame) {
    const cell = selectedCell(frame);
    const observedDepth = frame.observation.depthByCell[cell.cellId];
    const changed = frame.outcome.affectedCellIds.includes(cell.cellId);
    const identity = cell.occupants.length
      ? `Actor ${cell.occupants.join(', ')} on ${cell.material}`
      : cell.type === 'structure'
        ? `${cell.material === 'debris' ? 'Collapsed' : 'Bridge'} structure${cell.integrity == null ? '' : ` · integrity ${cell.integrity}`}`
        : `${cell.material[0].toUpperCase()}${cell.material.slice(1)} terrain`;
    const facts = [
      ['Physical type', cell.type],
      ['Truth changed', changed ? 'Yes' : 'No'],
      ['Observed', observedDepth == null ? 'No' : `Depth ${observedDepth}`],
      ['Memory', state.memoryVisible ? `${cell.memoryCount} records` : 'Layer hidden'],
    ];

    elements['cell-title'].textContent = `Cell ${cell.x}, ${cell.y}`;
    elements['cell-id'].textContent = cell.cellId;
    elements['cell-summary'].textContent = identity;
    const fragment = document.createDocumentFragment();
    for (const [term, value] of facts) {
      const wrapper = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = term;
      dd.textContent = value;
      wrapper.append(dt, dd);
      fragment.append(wrapper);
    }
    elements['cell-evidence'].replaceChildren(fragment);
  }

  function selectCell(cellId, { focus = false, announce = false } = {}) {
    const frame = payload.frames[state.index];
    if (!frame.world.cells.some((cell) => cell.cellId === cellId)) return;
    state.selectedCellId = cellId;
    for (const node of elements['world-grid'].querySelectorAll('[role="gridcell"]')) {
      const selected = node.dataset.cellId === cellId;
      node.tabIndex = selected ? 0 : -1;
      node.setAttribute('aria-selected', String(selected));
      if (selected && focus) node.focus();
    }
    renderCellInspector(frame);
    if (announce) elements.announcer.textContent = cellLabel(selectedCell(frame), frame);
  }

  function renderGrid(frame) {
    const fragment = document.createDocumentFragment();
    let row = null;
    for (const cell of frame.world.cells) {
      if (cell.x === 0) {
        row = document.createElement('div');
        row.className = 'grid-row';
        row.setAttribute('role', 'row');
        row.setAttribute('aria-rowindex', String(cell.y + 1));
        fragment.append(row);
      }
      const node = document.createElement('div');
      node.className = 'cell';
      node.id = `cell-${cell.x}-${cell.y}`;
      node.setAttribute('role', 'gridcell');
      node.setAttribute('aria-colindex', String(cell.x + 1));
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
      node.setAttribute('aria-selected', String(cell.cellId === state.selectedCellId));
      node.tabIndex = cell.cellId === state.selectedCellId ? 0 : -1;
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
      node.addEventListener('click', () => selectCell(cell.cellId, { focus: true, announce: true }));
      row.append(node);
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
    renderCellInspector(frame);
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
    renderCellInspector(payload.frames[state.index]);
    elements.announcer.textContent = `Memory layer ${state.memoryVisible ? 'shown' : 'hidden'}. Canonical truth is unchanged.`;
  }

  elements['world-grid'].addEventListener('keydown', (event) => {
    const cell = event.target.closest('[role="gridcell"]');
    if (!cell) return;
    const frame = payload.frames[state.index];
    const current = selectedCell(frame);
    let x = current.x;
    let y = current.y;
    if (event.key === 'ArrowLeft') x -= 1;
    else if (event.key === 'ArrowRight') x += 1;
    else if (event.key === 'ArrowUp') y -= 1;
    else if (event.key === 'ArrowDown') y += 1;
    else if (event.key === 'Home') x = 0;
    else if (event.key === 'End') x = frame.world.width - 1;
    else return;
    if (event.ctrlKey && event.key === 'Home') y = 0;
    if (event.ctrlKey && event.key === 'End') y = frame.world.height - 1;
    event.preventDefault();
    event.stopPropagation();
    x = Math.max(0, Math.min(frame.world.width - 1, x));
    y = Math.max(0, Math.min(frame.world.height - 1, y));
    selectCell(`C_${x}_${y}`, { focus: true, announce: true });
  });

  elements.previous.addEventListener('click', () => { stop(); goTo(state.index - 1); });
  elements.next.addEventListener('click', () => { stop(); goTo(state.index + 1); });
  elements.play.addEventListener('click', play);
  elements['memory-toggle'].addEventListener('click', toggleMemory);

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('summary, button, [role="gridcell"]')) return;
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
