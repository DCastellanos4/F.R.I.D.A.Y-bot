/**
 * D.A.V.I.S. Sector 1 - Interactive Messaging Service
 *
 * Provides:
 * - Ephemeral messages with TTL (Baileys ephemeralExpiration)
 * - Confirmation buttons for critical actions
 * - Interactive option lists with sections and rows
 * - Digital vCard 3.0 contact cards (.vcf)
 * - Native WhatsApp polls and vote tracking
 * - Interactive response parser for incoming button/list/poll events
 *
 * Compliance: Strict Zero Emojis policy across all payloads, logs, and errors.
 */

// Zero-emoji validator regex matching Unicode Extended Pictographic symbols
const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

/**
 * Validates that an object or string contains no emoji characters.
 * Throws an Error if an emoji is detected.
 *
 * @param {any} target
 * @param {string} [label='Payload']
 */
export function assertZeroEmojis(target, label = 'Payload') {
  if (target === null || target === undefined) {
    return;
  }
  if (typeof target === 'string') {
    if (EMOJI_REGEX.test(target)) {
      throw new Error(`${label} contains forbidden emoji characters`);
    }
    return;
  }
  if (Buffer.isBuffer(target)) {
    return;
  }
  if (Array.isArray(target)) {
    for (let i = 0; i < target.length; i++) {
      assertZeroEmojis(target[i], `${label}[${i}]`);
    }
    return;
  }
  if (typeof target === 'object') {
    for (const [key, val] of Object.entries(target)) {
      assertZeroEmojis(val, `${label}.${key}`);
    }
  }
}

/**
 * Unwraps Baileys message containers (ephemeral, viewOnce, documentWithCaption).
 *
 * @param {object} msg - Incoming message
 * @returns {object|null}
 */
function unwrapMessage(msg) {
  let m = msg?.message;
  if (!m) return null;
  if (m.ephemeralMessage) m = m.ephemeralMessage.message;
  if (m.viewOnceMessage) m = m.viewOnceMessage.message;
  if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
  if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
  return m || null;
}

// In-memory registry for tracking native WhatsApp poll votes
const pollVoteStore = new Map();

/**
 * Sends a message with ephemeral TTL (auto-delete timer).
 *
 * @param {object} sock - Baileys socket instance
 * @param {string} remoteJid - WhatsApp destination JID
 * @param {object|string} content - Message content payload
 * @param {number} expirationSeconds - TTL in seconds (e.g., 86400 for 24h, 604800 for 7d, 0 for off)
 * @returns {Promise<object>} Message receipt
 */
export async function sendEphemeralMessage(sock, remoteJid, content, expirationSeconds) {
  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new Error('Invalid socket instance provided');
  }
  if (typeof remoteJid !== 'string' || remoteJid.trim().length === 0) {
    throw new Error('Remote JID must be a non-empty string');
  }
  if (typeof expirationSeconds !== 'number' || Number.isNaN(expirationSeconds) || expirationSeconds < 0) {
    throw new Error('Expiration seconds must be a non-negative number');
  }
  if (!content) {
    throw new Error('Message content is required');
  }

  const payload = typeof content === 'string' ? { text: content } : { ...content };
  assertZeroEmojis(payload, 'Ephemeral payload');

  return await sock.sendMessage(remoteJid, payload, {
    ephemeralExpiration: expirationSeconds
  });
}

// Alias matching interface contract in PROJECT.md
export const sendEphemeral = sendEphemeralMessage;

/**
 * Sends native confirmation buttons for critical actions.
 *
 * @param {object} sock - Baileys socket instance
 * @param {string} remoteJid - WhatsApp destination JID
 * @param {object} options
 * @param {string} options.text - Main prompt text
 * @param {string} [options.footer] - Footer caption
 * @param {Array<{ id: string, text: string }>} options.buttons - Array of button definitions
 * @returns {Promise<object>} Message receipt
 */
export async function sendButtons(sock, remoteJid, options) {
  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new Error('Invalid socket instance provided');
  }
  if (typeof remoteJid !== 'string' || remoteJid.trim().length === 0) {
    throw new Error('Remote JID must be a non-empty string');
  }
  if (!options || typeof options !== 'object') {
    throw new Error('Buttons options must be an object');
  }
  if (typeof options.text !== 'string' || options.text.trim().length === 0) {
    throw new Error('Buttons text must be a non-empty string');
  }
  if (!Array.isArray(options.buttons) || options.buttons.length === 0) {
    throw new Error('Buttons options must contain a non-empty buttons array');
  }

  assertZeroEmojis(options, 'Buttons options');

  const formattedButtons = options.buttons.map((btn, index) => {
    const id = btn.id || btn.buttonId || `btn_${index + 1}`;
    const text = btn.text || (typeof btn.buttonText === 'object' ? btn.buttonText?.displayText : btn.buttonText) || '';
    return {
      id,
      text,
      buttonId: id,
      buttonText: { displayText: text },
      type: 1
    };
  });

  const payload = {
    text: options.text,
    ...(options.footer ? { footer: options.footer } : {}),
    buttons: formattedButtons
  };

  return await sock.sendMessage(remoteJid, payload);
}

/**
 * Sends an interactive selection list with sections and rows.
 *
 * @param {object} sock - Baileys socket instance
 * @param {string} remoteJid - WhatsApp destination JID
 * @param {object} options
 * @param {string} options.text - Message prompt text
 * @param {string} [options.title] - List title
 * @param {string} [options.footer] - List footer caption
 * @param {string} [options.buttonText] - Action button text (e.g. 'Ver Opciones')
 * @param {Array<{ title: string, rows: Array<{ id: string, title: string, description?: string }> }>} options.sections
 * @returns {Promise<object>} Message receipt
 */
export async function sendList(sock, remoteJid, options) {
  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new Error('Invalid socket instance provided');
  }
  if (typeof remoteJid !== 'string' || remoteJid.trim().length === 0) {
    throw new Error('Remote JID must be a non-empty string');
  }
  if (!options || typeof options !== 'object') {
    throw new Error('List options must be an object');
  }
  if (typeof options.text !== 'string' || options.text.trim().length === 0) {
    throw new Error('List text must be a non-empty string');
  }
  if (!Array.isArray(options.sections) || options.sections.length === 0) {
    throw new Error('List sections must contain at least one section');
  }

  assertZeroEmojis(options, 'List options');

  const formattedSections = options.sections.map((section, sIdx) => {
    const title = section.title || `Seccion ${sIdx + 1}`;
    const rows = Array.isArray(section.rows)
      ? section.rows.map((row, rIdx) => {
          const id = row.id || row.rowId || `row_${sIdx + 1}_${rIdx + 1}`;
          const rowTitle = row.title || '';
          const description = row.description || '';
          return {
            id,
            rowId: id,
            title: rowTitle,
            description
          };
        })
      : [];
    return {
      title,
      rows
    };
  });

  const payload = {
    text: options.text,
    ...(options.title ? { title: options.title } : {}),
    ...(options.footer ? { footer: options.footer } : {}),
    buttonText: options.buttonText || 'Ver Opciones',
    sections: formattedSections
  };

  return await sock.sendMessage(remoteJid, payload);
}

/**
 * Generates an RFC-compliant vCard 3.0 string.
 *
 * @param {object} contactInfo
 * @param {string} contactInfo.displayName - Full contact name
 * @param {string} contactInfo.phone - Telephone number
 * @param {string} [contactInfo.organization] - Company or organization name
 * @returns {string} Raw vCard 3.0 string
 */
export function generateVCard(contactInfo) {
  if (!contactInfo || typeof contactInfo !== 'object') {
    throw new Error('Contact info must be an object');
  }

  const displayName = (contactInfo.displayName || contactInfo.name || '').trim();
  const phone = (contactInfo.phone || contactInfo.tel || '').trim();

  if (!displayName) {
    throw new Error('Contact displayName is required');
  }
  if (!phone) {
    throw new Error('Contact phone is required');
  }

  assertZeroEmojis(contactInfo, 'Contact info');

  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  const waid = cleanPhone.replace('+', '');
  const organization = (contactInfo.organization || contactInfo.org || '').trim();

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${displayName}`
  ];

  if (organization) {
    lines.push(`ORG:${organization}`);
  }

  lines.push(`TEL;type=CELL;type=VOICE;waid=${waid}:${cleanPhone}`);
  lines.push('END:VCARD');

  return lines.join('\n');
}

/**
 * Sends a digital vCard (.vcf) contact card through Baileys.
 *
 * @param {object} sock - Baileys socket instance
 * @param {string} remoteJid - WhatsApp destination JID
 * @param {object} contactInfo
 * @param {string} contactInfo.displayName - Full contact name
 * @param {string} contactInfo.phone - Telephone number
 * @param {string} [contactInfo.organization] - Company or organization name
 * @returns {Promise<object>} Message receipt
 */
export async function sendVCard(sock, remoteJid, contactInfo) {
  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new Error('Invalid socket instance provided');
  }
  if (typeof remoteJid !== 'string' || remoteJid.trim().length === 0) {
    throw new Error('Remote JID must be a non-empty string');
  }

  const vcard = generateVCard(contactInfo);
  const displayName = contactInfo.displayName || contactInfo.name;

  const payload = {
    contacts: {
      displayName,
      contacts: [
        { vcard }
      ]
    }
  };

  return await sock.sendMessage(remoteJid, payload);
}

/**
 * Sends a native WhatsApp poll.
 *
 * @param {object} sock - Baileys socket instance
 * @param {string} remoteJid - WhatsApp destination JID
 * @param {object} pollOptions
 * @param {string} pollOptions.name - Poll question/title
 * @param {string[]} pollOptions.values - Array of option strings (2 to 12)
 * @param {number} [pollOptions.selectableCount=1] - Maximum selections allowed
 * @returns {Promise<object>} Message receipt
 */
export async function sendPoll(sock, remoteJid, pollOptions) {
  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new Error('Invalid socket instance provided');
  }
  if (typeof remoteJid !== 'string' || remoteJid.trim().length === 0) {
    throw new Error('Remote JID must be a non-empty string');
  }
  if (!pollOptions || typeof pollOptions !== 'object') {
    throw new Error('Poll options must be an object');
  }
  if (typeof pollOptions.name !== 'string' || pollOptions.name.trim().length === 0) {
    throw new Error('Poll must have a non-empty name string');
  }
  if (!Array.isArray(pollOptions.values)) {
    throw new Error('Poll values must be an array of strings');
  }
  if (pollOptions.values.length < 2) {
    throw new Error(`Poll must have at least 2 options, got ${pollOptions.values.length}`);
  }
  if (pollOptions.values.length > 12) {
    throw new Error(`Poll cannot exceed 12 options in WhatsApp, got ${pollOptions.values.length}`);
  }

  for (let i = 0; i < pollOptions.values.length; i++) {
    const val = pollOptions.values[i];
    if (typeof val !== 'string' || val.trim().length === 0) {
      throw new Error(`Poll option at index ${i} must be a non-empty string`);
    }
  }

  let selectableCount = 1;
  if (pollOptions.selectableCount !== undefined) {
    if (!Number.isInteger(pollOptions.selectableCount) || pollOptions.selectableCount < 1) {
      throw new Error('Poll selectableCount must be an integer >= 1');
    }
    if (pollOptions.selectableCount > pollOptions.values.length) {
      throw new Error(`Poll selectableCount (${pollOptions.selectableCount}) cannot exceed values count (${pollOptions.values.length})`);
    }
    selectableCount = pollOptions.selectableCount;
  }

  assertZeroEmojis(pollOptions, 'Poll options');

  const payload = {
    poll: {
      name: pollOptions.name.trim(),
      values: pollOptions.values.map(v => v.trim()),
      selectableCount
    }
  };

  return await sock.sendMessage(remoteJid, payload);
}

/**
 * Parses and records an incoming poll vote update message.
 *
 * @param {object} msg - Incoming Baileys message object
 * @returns {object|null} Normalized vote data or null if not a poll update
 */
export function parsePollVote(msg) {
  if (!msg || typeof msg !== 'object') {
    return null;
  }

  const m = unwrapMessage(msg);
  if (!m || !m.pollUpdateMessage) {
    return null;
  }

  const update = m.pollUpdateMessage;
  const pollKey = update.pollCreationMessageKey || {};
  const pollId = pollKey.id || null;
  const voterJid = msg.key?.participant || msg.key?.remoteJid || null;
  const selectedOptions = Array.isArray(update.vote?.selectedOptions)
    ? [...update.vote.selectedOptions]
    : [];
  const timestamp = msg.messageTimestamp || Math.floor(Date.now() / 1000);

  const voteRecord = {
    type: 'poll_vote',
    pollId,
    pollKey,
    voterJid,
    selectedOptions,
    timestamp
  };

  // Record into in-memory store
  if (pollId && voterJid) {
    if (!pollVoteStore.has(pollId)) {
      pollVoteStore.set(pollId, new Map());
    }
    pollVoteStore.get(pollId).set(voterJid, {
      selectedOptions,
      timestamp
    });
  }

  return voteRecord;
}

/**
 * Returns recorded votes for a specific poll ID.
 *
 * @param {string} pollId
 * @returns {Array<{ voterJid: string, selectedOptions: string[], timestamp: number }>}
 */
export function getRecordedPollVotes(pollId) {
  if (!pollId || !pollVoteStore.has(pollId)) {
    return [];
  }
  const voterMap = pollVoteStore.get(pollId);
  const results = [];
  for (const [voterJid, voteData] of voterMap.entries()) {
    results.push({
      voterJid,
      selectedOptions: voteData.selectedOptions,
      timestamp: voteData.timestamp
    });
  }
  return results;
}

/**
 * Clears recorded votes for a poll ID or all polls.
 *
 * @param {string} [pollId]
 */
export function clearRecordedPollVotes(pollId) {
  if (pollId) {
    pollVoteStore.delete(pollId);
  } else {
    pollVoteStore.clear();
  }
}

/**
 * Normalizes interactive responses (buttons, lists, polls) from incoming messages.
 *
 * @param {object} msg - Incoming Baileys message object
 * @returns {object|null} Normalized interactive response or null if plain text/other
 */
export function parseInteractiveResponse(msg) {
  if (!msg || typeof msg !== 'object') {
    return null;
  }

  const m = unwrapMessage(msg);
  if (!m) {
    return null;
  }

  // 1. Standard Button Response Message
  if (m.buttonsResponseMessage) {
    const btn = m.buttonsResponseMessage;
    return {
      type: 'button',
      id: btn.selectedButtonId || '',
      text: btn.selectedDisplayText || '',
      raw: btn
    };
  }

  // 2. Template Button Reply Message
  if (m.templateButtonReplyMessage) {
    const btn = m.templateButtonReplyMessage;
    return {
      type: 'button',
      id: btn.selectedId || btn.selectedButtonId || '',
      text: btn.selectedDisplayText || '',
      raw: btn
    };
  }

  // 3. Interactive Response Message (Native Flow)
  if (m.interactiveResponseMessage) {
    const nativeFlow = m.interactiveResponseMessage.nativeFlowResponseMessage;
    if (nativeFlow) {
      let params = {};
      try {
        params = JSON.parse(nativeFlow.paramsJson || '{}');
      } catch {
        params = {};
      }
      return {
        type: 'button',
        id: params.id || nativeFlow.id || '',
        text: params.title || params.text || '',
        raw: nativeFlow
      };
    }
  }

  // 4. List Response Message
  if (m.listResponseMessage) {
    const list = m.listResponseMessage;
    const selectedRowId = list.singleSelectReply?.selectedRowId || list.selectedRowId || '';
    return {
      type: 'list',
      id: selectedRowId,
      title: list.title || '',
      description: list.description || '',
      raw: list
    };
  }

  // 5. Poll Update Message
  if (m.pollUpdateMessage) {
    return parsePollVote(msg);
  }

  return null;
}
