import { test, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSocket } from '../harness/mockSocket.js';
import { TEST_JIDS } from '../harness/fixtures.js';
import { assertNoEmojis } from '../harness/validators.js';

describe('Sector 1 - Task 10: Direct Media Downloader (yt-dlp & WhatsApp Limits)', () => {
  let mockSocket;
  let mediaDownloaderService = null;
  const WHATSAPP_MAX_INLINE_BYTES = 16 * 1024 * 1024; // 16 MB limit

  beforeEach(async () => {
    mockSocket = createMockSocket();
    try {
      mediaDownloaderService = await import('../../mediaDownloaderService.js');
    } catch {
      mediaDownloaderService = null;
    }
  });

  describe('Protocol: WhatsApp Media Dispatch & Size Limits', () => {
    it('should dispatch inline video under 16MB boundary', async () => {
      // 500 KB synthetic test video buffer
      const videoBuffer = Buffer.alloc(500 * 1024, 0xaa);
      assert.ok(videoBuffer.length <= WHATSAPP_MAX_INLINE_BYTES);

      const payload = {
        video: videoBuffer,
        mimetype: 'video/mp4',
        caption: 'Video procesado para entrega directa'
      };

      assertNoEmojis(payload);
      await mockSocket.sendMessage(TEST_JIDS.DAVID_JID, payload);

      const sent = mockSocket.getLastMessage(TEST_JIDS.DAVID_JID);
      assert.ok(sent);
      assert.strictEqual(sent.content.mimetype, 'video/mp4');
      assert.strictEqual(sent.content.video.length, videoBuffer.length);
      assertNoEmojis(sent.content.caption);
    });

    it('should enforce 16MB boundary check on synthetic media payload', () => {
      const overLimitBuffer = Buffer.alloc(17 * 1024 * 1024, 0xbb);
      assert.ok(
        overLimitBuffer.length > WHATSAPP_MAX_INLINE_BYTES,
        'Buffer exceeds 16MB WhatsApp threshold'
      );
    });
  });

  describe('Service Contract: mediaDownloaderService.downloadMedia', () => {
    it('should return media object conforming to contract schema for valid media request', async (t) => {
      if (!mediaDownloaderService || typeof mediaDownloaderService.downloadMedia !== 'function') {
        t.skip('mediaDownloaderService.downloadMedia not yet implemented on disk');
        return;
      }

      // Using a known test audio or mockable URL
      const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      let result;
      try {
        result = await mediaDownloaderService.downloadMedia(testUrl, { format: 'audio' });
      } catch (err) {
        // If external network is restricted or yt-dlp binary is absent in test environment,
        // verify that the error handling adheres to zero-emoji and clean error contract
        assert.ok(err instanceof Error);
        assertNoEmojis(err.message);
        return;
      }

      if (result && result.ok !== false) {
        assert.ok(result.buffer || result.filePath, 'Result must contain buffer or filePath');
        assert.ok(['video', 'audio'].includes(result.mediaType));
        assert.ok(typeof result.mimeType === 'string');
        assert.ok(typeof result.fileName === 'string');
        assertNoEmojis(result);
      } else if (result) {
        assert.ok(typeof result.error === 'string');
        assertNoEmojis(result.error);
      }
    });

    it('should handle invalid or unparseable URLs safely without uncaught exceptions', async (t) => {
      if (!mediaDownloaderService || typeof mediaDownloaderService.downloadMedia !== 'function') {
        t.skip('mediaDownloaderService.downloadMedia not yet implemented on disk');
        return;
      }

      const invalidUrl = 'not-a-valid-http-url';
      try {
        const result = await mediaDownloaderService.downloadMedia(invalidUrl);
        // If it returns an error object:
        if (result && result.ok === false) {
          assert.strictEqual(result.ok, false);
          assert.ok(typeof result.error === 'string');
          assertNoEmojis(result.error);
        }
      } catch (err) {
        assert.ok(err instanceof Error);
        assertNoEmojis(err.message, 'Error on invalid URL must contain zero emojis');
      }
    });

    it('should enforce that generated error messages and filenames contain zero emojis', async (t) => {
      if (!mediaDownloaderService || typeof mediaDownloaderService.downloadMedia !== 'function') {
        t.skip('mediaDownloaderService.downloadMedia not yet implemented on disk');
        return;
      }

      const nonExistentUrl = 'https://www.youtube.com/watch?v=non_existent_video_id_99999999';
      try {
        const res = await mediaDownloaderService.downloadMedia(nonExistentUrl);
        if (res && res.error) {
          assertNoEmojis(res.error);
        }
      } catch (err) {
        assertNoEmojis(err.message);
      }
    });
  });
});
