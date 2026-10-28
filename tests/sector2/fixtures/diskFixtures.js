/**
 * Disk Storage Fixtures for Task 13 (Disk Storage Vigilante & Auto-Purge).
 *
 * Provides synthetic fs.statfsSync return values, df CLI outputs, and purge step results.
 * Strict Policy: Zero Emojis.
 */

const BLOCK_SIZE = 4096; // 4KB filesystem block
const TOTAL_BLOCKS = 12500000; // ~50GB total (51,200,000,000 bytes)

/**
 * Creates a synthetic statfs object matching native fs.statfsSync.
 *
 * @param {number} usedPercent - Usage percentage (0 - 100).
 * @param {number} [totalBytes=51200000000] - Total filesystem size (~50GB).
 * @returns {object} fs.statfsSync compatible object.
 */
export function createSyntheticStatfs(usedPercent, totalBytes = 51200000000) {
  const bsize = BLOCK_SIZE;
  const blocks = Math.floor(totalBytes / bsize);
  const usedBlocks = Math.floor((blocks * usedPercent) / 100);
  const freeBlocks = blocks - usedBlocks;

  return {
    type: 0xef53, // ext4 filesystem magic
    bsize,
    blocks,
    bfree: freeBlocks,
    bavail: freeBlocks, // available to non-root
    files: 3200000,
    ffree: 2800000
  };
}

export const DISK_SCENARIOS = {
  healthy60: {
    percent: 60,
    statfs: createSyntheticStatfs(60),
    description: 'Normal storage usage (60%), below 85% threshold'
  },
  nearThreshold84: {
    percent: 84,
    statfs: createSyntheticStatfs(84),
    description: 'Boundary test: 84% usage, must NOT trigger purge'
  },
  atThreshold85: {
    percent: 85,
    statfs: createSyntheticStatfs(85),
    description: 'Boundary test: exact 85% threshold'
  },
  overThreshold88: {
    percent: 88,
    statfs: createSyntheticStatfs(88),
    description: 'Over threshold (88%), MUST trigger 4-step purge'
  },
  critical95: {
    percent: 95,
    statfs: createSyntheticStatfs(95),
    description: 'Critical storage level (95%), triggers purge and escalation'
  },
  postPurgeSuccess80: {
    percent: 80,
    statfs: createSyntheticStatfs(80),
    description: 'Post-purge successful state: 80% used (< 85% threshold)'
  },
  postPurgeStillOver87: {
    percent: 87,
    statfs: createSyntheticStatfs(87),
    description: 'Post-purge failure state: still 87% used, triggers CRITICAL alert'
  }
};

export const SYNTHETIC_PURGE_OUTPUTS = {
  pm2Flush: '[PM2] Flushing /home/ubuntu/.pm2/logs\n[PM2] Logs flushed successfully.\n',
  aptClean: '',
  dockerPrune: [
    'Deleted Containers:',
    'c3d4e5f6a1b2',
    'b2c3d4e5f6a1',
    '',
    'Deleted Images:',
    'deleted: sha256:1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
    '',
    'Total reclaimed space: 1.842GB'
  ].join('\n'),
  tempClean: {
    deletedCount: 12,
    reclaimedBytes: 420000000 // ~420 MB
  }
};
