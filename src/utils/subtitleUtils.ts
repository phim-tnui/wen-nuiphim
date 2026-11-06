export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleTrackOption {
  id: string;
  label: string;
  url: string;
  lang: string;
}

function parseTimecodeToSeconds(tc: string): number {
  const clean = tc.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2]) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1]) || 0;
    return m * 60 + s;
  }
  return parseFloat(clean) || 0;
}

/**
 * Parses WebVTT or SRT subtitle text into an array of timed cues.
 */
export function parseSubtitleText(rawText: string): SubtitleCue[] {
  if (!rawText || typeof rawText !== 'string') return [];

  const normalized = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^\uFEFF/, '');

  const blocks = normalized.split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    if (lines[0].startsWith('WEBVTT') || lines[0].startsWith('NOTE')) continue;

    let timeLineIdx = -1;
    for (let i = 0; i < Math.min(lines.length, 3); i++) {
      if (lines[i].includes('-->')) {
        timeLineIdx = i;
        break;
      }
    }
    if (timeLineIdx === -1) continue;

    const timeLine = lines[timeLineIdx];
    const arrowParts = timeLine.split('-->');
    if (arrowParts.length < 2) continue;

    const startStr = arrowParts[0].trim();
    const endStr = arrowParts[1].trim().split(/\s+/)[0];

    const start = parseTimecodeToSeconds(startStr);
    const end = parseTimecodeToSeconds(endStr);
    if (isNaN(start) || isNaN(end) || end <= start) continue;

    const textLines = lines
      .slice(timeLineIdx + 1)
      .map((line) =>
        line
          .replace(/<[^>]+>/g, '')
          .replace(/\{\\[^}]+\}/g, '')
          .trim()
      )
      .filter(Boolean);

    if (textLines.length > 0) {
      cues.push({
        start,
        end,
        text: textLines.join('\n'),
      });
    }
  }

  return cues;
}

/**
 * Classifies a stream into Priority Tier 1 (Thuyết Minh), Tier 2 (Vietsub), or Tier 3 (Other).
 */
export function getStreamPriorityInfo(stream: {
  name?: string;
  title?: string;
  url?: string;
  embedUrl?: string;
  externalUrl?: string;
  priorityTier?: number;
  audioLabel?: string;
}): {
  tier: 1 | 2 | 3;
  tierLabel: string;
  shortBadge: string;
  isDirectHls: boolean;
} {
  const rawName = String(stream.name || '');
  const rawTitle = String(stream.title || '');
  const cleanText = `${rawName} ${rawTitle}`
    .replace(/\[kèm phụ đề rời\]/gi, '')
    .toLowerCase();

  const isDirectHls = Boolean(
    stream.url &&
      !stream.url.includes('/api/player') &&
      !(!stream.url && (stream.embedUrl || stream.externalUrl))
  );

  const isTm =
    stream.priorityTier === 1 ||
    cleanText.includes('thuyết minh') ||
    cleanText.includes('thuyet minh') ||
    cleanText.includes('lồng tiếng') ||
    cleanText.includes('long tieng') ||
    cleanText.includes('song ngữ') ||
    cleanText.includes('song ngu') ||
    cleanText.includes('vie audio') ||
    cleanText.includes('viet audio') ||
    cleanText.includes('audio tiếng việt') ||
    cleanText.includes('audio tieng viet') ||
    /\b(tm|lt)\b/i.test(cleanText);

  if (isTm) {
    const isLt = cleanText.includes('lồng tiếng') || cleanText.includes('long tieng');
    return {
      tier: 1,
      tierLabel: isLt ? 'Ưu tiên #1: Lồng Tiếng' : 'Ưu tiên #1: Thuyết Minh',
      shortBadge: isLt ? 'Lồng Tiếng' : 'Thuyết Minh',
      isDirectHls,
    };
  }

  const isVietsub =
    stream.priorityTier === 2 ||
    cleanText.includes('vietsub') ||
    cleanText.includes('viet sub') ||
    cleanText.includes('phụ đề') ||
    cleanText.includes('phu de') ||
    cleanText.includes('tiếng việt') ||
    cleanText.includes('tieng viet') ||
    cleanText.includes('vietnamese') ||
    /\b(vsub|vs)\b/i.test(cleanText);

  if (isVietsub) {
    return {
      tier: 2,
      tierLabel: 'Ưu tiên #2: Vietsub',
      shortBadge: 'Vietsub',
      isDirectHls,
    };
  }

  return {
    tier: 3,
    tierLabel: 'Ưu tiên #3: Nguồn Khác',
    shortBadge: 'Nguồn Khác',
    isDirectHls,
  };
}
