import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInteractiveResponse,
  getRecordedPollVotes,
  clearRecordedPollVotes,
  configurePollStoreLimits,
  pruneExpiredPolls,
  getPollStoreSize,
  DEFAULT_POLL_STORE_MAX_ENTRIES,
  DEFAULT_POLL_STORE_TTL_MS
} from '../../src/core/interactiveService.js';

describe('Sector 1 - pollVoteStore: TTL and Capacity Limits', () => {
  beforeEach(() => {
    clearRecordedPollVotes();
    configurePollStoreLimits({
      maxEntries: DEFAULT_POLL_STORE_MAX_ENTRIES,
      ttlMs: DEFAULT_POLL_STORE_TTL_MS
    });
  });

  it('records votes per poll and voter correctly', () => {
    const msg = {
      key: { remoteJid: 'user1@s.whatsapp.net', participant: 'user1@s.whatsapp.net' },
      message: {
        pollUpdateMessage: {
          pollCreationMessageKey: { id: 'POLL_A' },
          vote: { selectedOptions: ['opt_1', 'opt_2'] }
        }
      }
    };

    const res = parseInteractiveResponse(msg);
    assert.ok(res);
    assert.equal(res.type, 'poll_vote');
    assert.equal(res.pollId, 'POLL_A');

    const votes = getRecordedPollVotes('POLL_A');
    assert.equal(votes.length, 1);
    assert.equal(votes[0].voterJid, 'user1@s.whatsapp.net');
    assert.deepEqual(votes[0].selectedOptions, ['opt_1', 'opt_2']);
  });

  it('enforces maxEntries limit by evicting oldest poll (LRU/FIFO)', () => {
    configurePollStoreLimits({ maxEntries: 2, ttlMs: 100000 });

    const makeMsg = (pollId, voterJid) => ({
      key: { remoteJid: voterJid, participant: voterJid },
      message: {
        pollUpdateMessage: {
          pollCreationMessageKey: { id: pollId },
          vote: { selectedOptions: ['opt_1'] }
        }
      }
    });

    parseInteractiveResponse(makeMsg('POLL_1', 'user1@s.whatsapp.net'));
    parseInteractiveResponse(makeMsg('POLL_2', 'user2@s.whatsapp.net'));
    assert.equal(getPollStoreSize(), 2);

    // Adding 3rd poll must evict POLL_1
    parseInteractiveResponse(makeMsg('POLL_3', 'user3@s.whatsapp.net'));
    assert.equal(getPollStoreSize(), 2);
    assert.deepEqual(getRecordedPollVotes('POLL_1'), []);
    assert.equal(getRecordedPollVotes('POLL_2').length, 1);
    assert.equal(getRecordedPollVotes('POLL_3').length, 1);
  });

  it('prunes polls older than configured TTL', () => {
    configurePollStoreLimits({ maxEntries: 10, ttlMs: 50 });

    const msg = {
      key: { remoteJid: 'user1@s.whatsapp.net', participant: 'user1@s.whatsapp.net' },
      message: {
        pollUpdateMessage: {
          pollCreationMessageKey: { id: 'POLL_EXPIRE' },
          vote: { selectedOptions: ['opt_1'] }
        }
      }
    };

    parseInteractiveResponse(msg);
    assert.equal(getRecordedPollVotes('POLL_EXPIRE').length, 1);

    // Prune with future timestamp
    const futureTime = Date.now() + 100;
    pruneExpiredPolls(futureTime);

    assert.equal(getRecordedPollVotes('POLL_EXPIRE').length, 0);
    assert.equal(getPollStoreSize(), 0);
  });
});
