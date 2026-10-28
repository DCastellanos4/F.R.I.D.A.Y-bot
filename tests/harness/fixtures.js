import crypto from 'node:crypto';

/**
 * Standard test JIDs and constants.
 */
export const TEST_JIDS = {
  DAVID_PHONE: '34635605605',
  DAVID_JID: '34635605605@s.whatsapp.net',
  DAVID_LID: '149868706304033@lid',
  EXTERNAL_JID: '34600112233@s.whatsapp.net',
  EXTERNAL_PHONE: '34600112233',
  VIP_EXTERNAL_JID: '34699887766@s.whatsapp.net',
  GROUP_JID: '120363028472910384@g.us'
};

/**
 * Helper to generate random WhatsApp message IDs.
 *
 * @param {string} [prefix='DAVIS']
 * @returns {string}
 */
export function generateMessageId(prefix = 'DAVIS') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

/**
 * Constructs a synthetic structurally-valid OGG Opus header buffer.
 * Contains 'OggS' container header and 'OpusHead' identification payload.
 *
 * @param {object} [options]
 * @param {number} [options.durationSeconds=1]
 * @returns {Buffer}
 */
export function createSyntheticOggOpusBuffer(options = {}) {
  // Page 1: OpusHead Header
  const opusHeadPayload = Buffer.from([
    0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, // 'OpusHead' (8 bytes)
    0x01,                                           // Version 1 (1 byte)
    0x01,                                           // 1 Channel (Mono) (1 byte)
    0x00, 0x00,                                     // Pre-skip 0 (2 bytes)
    0x80, 0xbb, 0x00, 0x00,                         // Input sample rate 48000 Hz (4 bytes)
    0x00, 0x00,                                     // Output gain 0 dB (2 bytes)
    0x00                                            // Channel mapping family 0 (1 byte)
  ]); // 19 bytes total

  const oggPageHeader = Buffer.alloc(28);
  oggPageHeader.write('OggS', 0, 4, 'ascii'); // Magic 0-3
  oggPageHeader.writeUInt8(0x00, 4);          // Stream version 0
  oggPageHeader.writeUInt8(0x02, 5);          // Header type: BOS (Beginning of Stream)
  oggPageHeader.writeBigUInt64LE(0n, 6);      // Granule position 0
  oggPageHeader.writeUInt32LE(0x1337BEEF, 14); // Bitstream serial number
  oggPageHeader.writeUInt32LE(0, 18);         // Page sequence number 0
  oggPageHeader.writeUInt32LE(0, 22);         // Checksum (zero for synthetic)
  oggPageHeader.writeUInt8(1, 26);            // 1 segment
  oggPageHeader.writeUInt8(opusHeadPayload.length, 27); // Segment length (19)

  return Buffer.concat([oggPageHeader, opusHeadPayload]);
}

/**
 * Creates a standard incoming/outgoing WhatsApp text message structure.
 *
 * @param {object} params
 * @param {string} params.text
 * @param {boolean} [params.fromMe=false]
 * @param {string} [params.remoteJid=TEST_JIDS.DAVID_JID]
 * @param {string} [params.senderJid]
 * @param {string} [params.id]
 * @param {number} [params.timestamp]
 * @returns {object} Baileys WebMessageInfo
 */
export function createTextMessage({
  text,
  fromMe = false,
  remoteJid = TEST_JIDS.DAVID_JID,
  senderJid,
  id = generateMessageId('TXT'),
  timestamp = Math.floor(Date.now() / 1000)
}) {
  return {
    key: {
      remoteJid,
      fromMe,
      id,
      participant: remoteJid.endsWith('@g.us') ? (senderJid || TEST_JIDS.EXTERNAL_JID) : undefined
    },
    messageTimestamp: timestamp,
    pushName: fromMe ? 'DAVIS' : 'David',
    message: {
      conversation: text
    }
  };
}

/**
 * Creates an extended text message (with mentions context).
 *
 * @param {object} params
 * @param {string} params.text
 * @param {string[]} [params.mentions=[]]
 * @param {boolean} [params.fromMe=false]
 * @param {string} [params.remoteJid=TEST_JIDS.GROUP_JID]
 * @param {string} [params.senderJid=TEST_JIDS.EXTERNAL_JID]
 * @param {string} [params.id]
 * @param {number} [params.timestamp]
 * @returns {object}
 */
export function createGroupTextMessage({
  text,
  mentions = [],
  fromMe = false,
  remoteJid = TEST_JIDS.GROUP_JID,
  senderJid = TEST_JIDS.EXTERNAL_JID,
  id = generateMessageId('GRP'),
  timestamp = Math.floor(Date.now() / 1000)
}) {
  return {
    key: {
      remoteJid,
      fromMe,
      id,
      participant: senderJid
    },
    messageTimestamp: timestamp,
    pushName: 'GroupParticipant',
    message: {
      extendedTextMessage: {
        text,
        contextInfo: {
          mentionedJid: mentions
        }
      }
    }
  };
}

/**
 * Creates an incoming/outgoing WhatsApp voice note message structure (PTT).
 *
 * @param {object} params
 * @param {Buffer} [params.audioBuffer]
 * @param {number} [params.durationSeconds=5]
 * @param {boolean} [params.ptt=true]
 * @param {boolean} [params.fromMe=false]
 * @param {string} [params.remoteJid=TEST_JIDS.DAVID_JID]
 * @param {string} [params.senderJid]
 * @param {string} [params.id]
 * @param {number} [params.timestamp]
 * @returns {object}
 */
export function createVoiceMessage({
  audioBuffer = createSyntheticOggOpusBuffer(),
  durationSeconds = 5,
  ptt = true,
  fromMe = false,
  remoteJid = TEST_JIDS.DAVID_JID,
  senderJid,
  id = generateMessageId('VOX'),
  timestamp = Math.floor(Date.now() / 1000)
}) {
  return {
    key: {
      remoteJid,
      fromMe,
      id,
      participant: remoteJid.endsWith('@g.us') ? (senderJid || TEST_JIDS.EXTERNAL_JID) : undefined
    },
    messageTimestamp: timestamp,
    pushName: fromMe ? 'DAVIS' : 'David',
    message: {
      audioMessage: {
        url: 'https://mock.whatsapp.net/audio.ogg',
        mimetype: 'audio/ogg; codecs=opus',
        fileSha256: crypto.createHash('sha256').update(audioBuffer).digest(),
        fileLength: audioBuffer.length,
        seconds: durationSeconds,
        ptt: ptt
      }
    },
    _rawBuffer: audioBuffer
  };
}

/**
 * Creates an incoming button response message from a user.
 *
 * @param {object} params
 * @param {string} params.selectedButtonId
 * @param {string} params.selectedDisplayText
 * @param {string} [params.remoteJid=TEST_JIDS.DAVID_JID]
 * @param {string} [params.id]
 * @returns {object}
 */
export function createButtonResponseMessage({
  selectedButtonId,
  selectedDisplayText,
  remoteJid = TEST_JIDS.DAVID_JID,
  id = generateMessageId('BTN_REP')
}) {
  return {
    key: {
      remoteJid,
      fromMe: false,
      id
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: {
      buttonsResponseMessage: {
        selectedButtonId,
        selectedDisplayText,
        type: 1
      }
    }
  };
}

/**
 * Creates an incoming list response message from a user.
 *
 * @param {object} params
 * @param {string} params.selectedRowId
 * @param {string} [params.title='']
 * @param {string} [params.description='']
 * @param {string} [params.remoteJid=TEST_JIDS.DAVID_JID]
 * @param {string} [params.id]
 * @returns {object}
 */
export function createListResponseMessage({
  selectedRowId,
  title = '',
  description = '',
  remoteJid = TEST_JIDS.DAVID_JID,
  id = generateMessageId('LST_REP')
}) {
  return {
    key: {
      remoteJid,
      fromMe: false,
      id
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: {
      listResponseMessage: {
        title,
        description,
        singleSelectReply: {
          selectedRowId
        }
      }
    }
  };
}

/**
 * Creates an incoming poll vote update message from a user.
 *
 * @param {object} params
 * @param {object} params.pollCreationMessageKey
 * @param {string[]} params.selectedOptions
 * @param {string} [params.remoteJid=TEST_JIDS.DAVID_JID]
 * @param {string} [params.senderJid=TEST_JIDS.DAVID_JID]
 * @param {string} [params.id]
 * @returns {object}
 */
export function createPollVoteMessage({
  pollCreationMessageKey,
  selectedOptions = [],
  remoteJid = TEST_JIDS.DAVID_JID,
  senderJid = TEST_JIDS.DAVID_JID,
  id = generateMessageId('POLL_VOTE')
}) {
  return {
    key: {
      remoteJid,
      fromMe: false,
      id,
      participant: remoteJid.endsWith('@g.us') ? senderJid : undefined
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: {
      pollUpdateMessage: {
        pollCreationMessageKey,
        vote: {
          selectedOptions,
          encPayload: Buffer.from('mock_encrypted_payload'),
          encIv: Buffer.from('mock_encrypted_iv')
        }
      }
    }
  };
}

/**
 * Creates a vCard contact payload.
 *
 * @param {object} params
 * @param {string} params.displayName
 * @param {string} params.phone
 * @param {string} [params.organization]
 * @returns {string} Raw vCard 3.0 string
 */
export function createVCardString({ displayName, phone, organization = '' }) {
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${displayName}`,
    `ORG:${organization}`,
    `TEL;type=CELL;type=VOICE;waid=${cleanPhone.replace('+', '')}:${cleanPhone}`,
    'END:VCARD'
  ].join('\n');
}
