import { OUTPUT_THRESHOLDS } from './constants';

export interface EncodeStats {
  inputChars: number;
  wireBytes: number;
  outputChars: number;
}

export interface PipelineSegment {
  text: string;
  monospace?: boolean;
  color?: string;
}

/** Build pipeline segments: ✏N → 🔒N → 📤N */
export function formatPipeline(stats: EncodeStats): PipelineSegment[] {
  const threshold = OUTPUT_THRESHOLDS.find(t => stats.outputChars <= t.limit)
    ?? { color: '#d97706' };
  return [
    { text: `📝${stats.inputChars} → ` },
    { text: `🔒${stats.wireBytes}`, monospace: true },
    { text: ' → ' },
    { text: `📤${stats.outputChars}`, color: threshold.color },
  ];
}
