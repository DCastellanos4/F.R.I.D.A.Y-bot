import crypto from 'node:crypto';
import EventEmitter from 'node:events';

/**
 * Creates a mock Baileys WASocket instance that captures all outbound calls
 * and provides inspection methods for verification.
 *
 * @param {object} [config]
 * @returns {object} Mock Baileys socket
 */
export function createMockSocket(config = {}) {
  const sentMessages = [];
  const presenceUpdates = [];
  const readReceipts = [];
  const emitter = new EventEmitter();
  const mockGroups = new Map();

  const mock = {
    // History storage
    sentMessages,
    presenceUpdates,
    readReceipts,

    // Event system matching Baileys sock.ev
    ev: {
      on: (event, handler) => emitter.on(event, handler),
      off: (event, handler) => emitter.off(event, handler),
      emit: (event, data) => emitter.emit(event, data),
      removeAllListeners: (event) => emitter.removeAllListeners(event)
    },

    /**
     * Intercepts Baileys sock.sendMessage.
     *
     * @param {string} jid - Target WhatsApp JID.
     * @param {object} content - Message content payload.
     * @param {object} [options] - Options (quoted, ephemeralExpiration, etc.)
     * @returns {Promise<object>} Baileys message structure
     */
    async sendMessage(jid, content, options = {}) {
      const msgId = `MOCK_${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
      const timestamp = Math.floor(Date.now() / 1000);

      const record = {
        id: msgId,
        jid,
        content,
        options,
        timestamp,
        // Classification helper flags
        isAudio: Boolean(content?.audio),
        isPtt: Boolean(content?.ptt),
        isButtons: Boolean(content?.buttons || content?.templateButtons),
        isList: Boolean(content?.sections || content?.buttonText),
        isPoll: Boolean(content?.poll),
        isVCard: Boolean(content?.contacts || content?.vcard),
        isEphemeral: Boolean(options?.ephemeralExpiration !== undefined || content?.ephemeralExpiration !== undefined),
        ephemeralTtl: options?.ephemeralExpiration ?? content?.ephemeralExpiration
      };

      sentMessages.push(record);

      return {
        key: {
          remoteJid: jid,
          fromMe: true,
          id: msgId
        },
        messageTimestamp: timestamp,
        message: content
      };
    },

    /**
     * Intercepts Baileys sock.sendPresenceUpdate.
     *
     * @param {string} type - 'available' | 'unavailable' | 'composing' | 'recording' | 'paused'
     * @param {string} [jid] - Remote JID
     * @returns {Promise<void>}
     */
    async sendPresenceUpdate(type, jid) {
      presenceUpdates.push({
        type,
        jid,
        timestamp: Date.now()
      });
    },

    /**
     * Intercepts Baileys sock.readMessages.
     *
     * @param {Array<object>} keys - Array of message keys
     * @returns {Promise<void>}
     */
    async readMessages(keys) {
      readReceipts.push({
        keys,
        timestamp: Date.now()
      });
    },

    /**
     * Intercepts Baileys sock.groupMetadata.
     *
     * @param {string} groupJid - Group JID
     * @returns {Promise<object>}
     */
    async groupMetadata(groupJid) {
      if (mockGroups.has(groupJid)) {
        return mockGroups.get(groupJid);
      }
      return {
        id: groupJid,
        subject: 'Mock Group',
        participants: [
          { id: '34635605605@s.whatsapp.net', admin: 'admin' },
          { id: '34600112233@s.whatsapp.net', admin: null }
        ],
        creation: Math.floor(Date.now() / 1000)
      };
    },

    /**
     * Mock helper to configure mock group metadata.
     */
    setGroupMetadata(groupJid, metadata) {
      mockGroups.set(groupJid, metadata);
    },

    /**
     * Query all sent messages matching a JID.
     */
    getSentMessages(filterJid) {
      if (!filterJid) return [...sentMessages];
      return sentMessages.filter(m => m.jid === filterJid);
    },

    /**
     * Query the last sent message.
     */
    getLastMessage(filterJid) {
      const filtered = filterJid ? sentMessages.filter(m => m.jid === filterJid) : sentMessages;
      return filtered.length > 0 ? filtered[filtered.length - 1] : null;
    },

    /**
     * Query audio messages.
     */
    getAudioMessages(filterJid) {
      return this.getSentMessages(filterJid).filter(m => m.isAudio);
    },

    /**
     * Query PTT voice note messages.
     */
    getPttMessages(filterJid) {
      return this.getSentMessages(filterJid).filter(m => m.isAudio && m.isPtt);
    },

    /**
     * Query button messages.
     */
    getButtonMessages(filterJid) {
      return this.getSentMessages(filterJid).filter(m => m.isButtons);
    },

    /**
     * Query list messages.
     */
    getListMessages(filterJid) {
      return this.getSentMessages(filterJid).filter(m => m.isList);
    },

    /**
     * Query poll messages.
     */
    getPollMessages(filterJid) {
      return this.getSentMessages(filterJid).filter(m => m.isPoll);
    },

    /**
     * Query vCard contact messages.
     */
    getVCardMessages(filterJid) {
      return this.getSentMessages(filterJid).filter(m => m.isVCard);
    },

    /**
     * Query ephemeral messages with TTL.
     */
    getEphemeralMessages(filterJid) {
      return this.getSentMessages(filterJid).filter(m => m.isEphemeral);
    },

    /**
     * Clears all captured state.
     */
    clear() {
      sentMessages.length = 0;
      presenceUpdates.length = 0;
      readReceipts.length = 0;
    }
  };

  return mock;
}
