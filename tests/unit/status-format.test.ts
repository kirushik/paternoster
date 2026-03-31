import { describe, it, expect } from 'vitest';
import { formatPipeline, type EncodeStats } from '../../src/status-format';

function stats(inputChars: number, wireBytes: number, outputChars: number): EncodeStats {
  return { inputChars, wireBytes, outputChars };
}

describe('formatPipeline', () => {
  it('returns 4 segments with correct structure', () => {
    const segs = formatPipeline(stats(42, 38, 334));
    expect(segs).toHaveLength(4);
    expect(segs[0].text).toContain('📝');
    expect(segs[1].text).toContain('🔒');
    expect(segs[2].text).toBe(' → ');
    expect(segs[3].text).toContain('📤');
  });

  it('embeds numbers in emoji-prefixed text', () => {
    const segs = formatPipeline(stats(42, 38, 334));
    expect(segs[0].text).toBe('📝42 → ');
    expect(segs[1].text).toBe('🔒38');
    expect(segs[3].text).toBe('📤334');
  });

  it('marks wire bytes segment as monospace', () => {
    const segs = formatPipeline(stats(10, 20, 100));
    expect(segs[1].monospace).toBe(true);
  });

  // Threshold color tests
  it('uses green for output ≤280 (tweet)', () => {
    const segs = formatPipeline(stats(5, 19, 150));
    expect(segs[3].color).toBe('#34c759');
  });

  it('uses green for exactly 280', () => {
    const segs = formatPipeline(stats(5, 19, 280));
    expect(segs[3].color).toBe('#34c759');
  });

  it('uses gray for 281 (just over tweet limit)', () => {
    const segs = formatPipeline(stats(10, 30, 281));
    expect(segs[3].color).toBe('#8e8e93');
  });

  it('uses gray for output ≤4096 (Telegram)', () => {
    const segs = formatPipeline(stats(42, 38, 2847));
    expect(segs[3].color).toBe('#8e8e93');
  });

  it('uses gray for exactly 4096', () => {
    const segs = formatPipeline(stats(100, 80, 4096));
    expect(segs[3].color).toBe('#8e8e93');
  });

  it('uses amber for 4097 (just over Telegram limit)', () => {
    const segs = formatPipeline(stats(100, 80, 4097));
    expect(segs[3].color).toBe('#d97706');
  });

  it('uses amber for large output ≤50000 (WhatsApp)', () => {
    const segs = formatPipeline(stats(500, 400, 38000));
    expect(segs[3].color).toBe('#d97706');
  });

  it('uses amber for output >50000 (fallback)', () => {
    const segs = formatPipeline(stats(1000, 800, 60000));
    expect(segs[3].color).toBe('#d97706');
  });

  it('does not set monospace or color on plain text segments', () => {
    const segs = formatPipeline(stats(42, 38, 334));
    expect(segs[0].monospace).toBeUndefined();
    expect(segs[0].color).toBeUndefined();
    expect(segs[2].monospace).toBeUndefined();
    expect(segs[2].color).toBeUndefined();
  });
});
