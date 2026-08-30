import { createHash } from 'node:crypto';

export const MEMORY_BUDGET = Object.freeze({
  working: 16,
  episodic: 8,
  compressed: 4,
  lineageRefs: 16,
});

export function cellId(x, y) {
  return `C_${x}_${y}`;
}

export function createCell(x, y) {
  return {
    cellId: cellId(x, y),
    x,
    y,
    canonicalRevision: 0,
    truthState: {
      type: 'terrain',
      material: 'ground',
      occupants: [],
      properties: {},
    },
    memory: {
      working: [],
      episodic: [],
      compressed: [],
      lineageRefs: [],
    },
    memoryBudget: { ...MEMORY_BUDGET },
    wakeState: 'DORMANT',
    specialistSpawnBudget: 8,
    authorityClass: 'CELL_LOCAL',
    lastActiveRevision: 0,
  };
}

export function createWorld({ width = 16, height = 16, memoryEnabled = true } = {}) {
  const cells = {};
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = createCell(x, y);
      cells[cell.cellId] = cell;
    }
  }

  const world = {
    schema: 'axm.echoworld/v0.01',
    width,
    height,
    revision: 0,
    memoryEnabled,
    cells,
    actors: {
      A: { actorId: 'A', x: 1, y: 1 },
      B: { actorId: 'B', x: 4, y: 1 },
    },
    receipts: {
      truth: [],
      memory: [],
      specialists: [],
      handoffs: [],
    },
  };

  world.cells[cellId(1, 1)].truthState.occupants.push('A');
  world.cells[cellId(4, 1)].truthState.occupants.push('B');
  world.cells[cellId(2, 1)].truthState.type = 'structure';
  world.cells[cellId(2, 1)].truthState.material = 'bridge';
  world.cells[cellId(2, 1)].truthState.properties.integrity = 100;

  return world;
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObject(value[key])]),
    );
  }
  return value;
}

export function canonicalProjection(world) {
  const cells = {};
  for (const id of Object.keys(world.cells).sort()) {
    const cell = world.cells[id];
    cells[id] = {
      cellId: cell.cellId,
      x: cell.x,
      y: cell.y,
      canonicalRevision: cell.canonicalRevision,
      truthState: {
        type: cell.truthState.type,
        material: cell.truthState.material,
        occupants: [...cell.truthState.occupants].sort(),
        properties: sortObject(cell.truthState.properties),
      },
    };
  }

  const actors = {};
  for (const id of Object.keys(world.actors).sort()) {
    actors[id] = { ...world.actors[id] };
  }

  return {
    schema: world.schema,
    width: world.width,
    height: world.height,
    revision: world.revision,
    cells,
    actors,
  };
}

export function canonicalHash(world) {
  const encoded = JSON.stringify(canonicalProjection(world));
  return createHash('sha256').update(encoded).digest('hex');
}

export function persistWorld(world) {
  return JSON.stringify(world);
}

export function reloadWorld(serialized) {
  return JSON.parse(serialized);
}
