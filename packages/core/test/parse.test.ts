import { describe, it, expect } from 'vitest';
import { parseSrt, parseVtt, parseSubtitles } from '../src/parse.js';

describe('parseSrt', () => {
  it('parses a well-formed basic file', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:04,000',
      'Hello there.',
      '',
      '2',
      '00:00:05,000 --> 00:00:07,500',
      'General Kenobi.',
      ''
    ].join('\n');
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ index: 1, startMs: 1000, endMs: 4000, text: 'Hello there.' });
    expect(cues[1]).toEqual({ index: 2, startMs: 5000, endMs: 7500, text: 'General Kenobi.' });
  });

  it('strips a leading BOM', () => {
    const srt = '﻿1\n00:00:01,000 --> 00:00:02,000\nHi.\n';
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(1);
    expect(cues[0]?.text).toBe('Hi.');
  });

  it('handles CRLF line endings', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:02,000\r\nHi.\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nBye.\r\n';
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(2);
    expect(cues[1]?.text).toBe('Bye.');
  });

  it('tolerates missing index numbers', () => {
    const srt = '00:00:01,000 --> 00:00:02,000\nNo index here.\n\n00:00:03,000 --> 00:00:04,000\nStill no index.\n';
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]?.text).toBe('No index here.');
    expect(cues[1]?.text).toBe('Still no index.');
    // Indices are synthesized sequentially regardless.
    expect(cues.map((c) => c.index)).toEqual([1, 2]);
  });

  it('strips HTML-ish tags and {\\an8}-style override tags', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\n{\\an8}<i>Italic</i> and <b>bold</b> text.\n';
    const cues = parseSrt(srt);
    expect(cues[0]?.text).toBe('Italic and bold text.');
  });

  it('joins multi-line cue text with a single space', () => {
    const srt = '1\n00:00:01,000 --> 00:00:04,000\nLine one\nLine two\n';
    const cues = parseSrt(srt);
    expect(cues[0]?.text).toBe('Line one Line two');
  });

  it('skips blocks without a timing line', () => {
    const srt = 'just some stray text\n\n1\n00:00:01,000 --> 00:00:02,000\nReal cue.\n';
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(1);
    expect(cues[0]?.text).toBe('Real cue.');
  });
});

describe('parseVtt', () => {
  it('parses a well-formed basic file with the WEBVTT header', () => {
    const vtt = ['WEBVTT', '', '00:00:01.000 --> 00:00:04.000', 'Hello there.', ''].join('\n');
    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toEqual({ index: 1, startMs: 1000, endMs: 4000, text: 'Hello there.' });
  });

  it('skips NOTE and STYLE blocks', () => {
    const vtt = [
      'WEBVTT',
      '',
      'NOTE this is a comment',
      'spanning two lines',
      '',
      'STYLE',
      '::cue { color: yellow; }',
      '',
      '00:00:01.000 --> 00:00:02.000',
      'Real cue.',
      ''
    ].join('\n');
    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0]?.text).toBe('Real cue.');
  });

  it('allows the hour component to be omitted', () => {
    const vtt = ['WEBVTT', '', '00:01.000 --> 00:04.000', 'Short form timestamp.', ''].join('\n');
    const cues = parseVtt(vtt);
    expect(cues[0]?.startMs).toBe(1000);
    expect(cues[0]?.endMs).toBe(4000);
  });

  it('strips cue settings after the end timestamp', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:02.000 align:start position:10% line:0',
      'Positioned cue.',
      ''
    ].join('\n');
    const cues = parseVtt(vtt);
    expect(cues[0]?.startMs).toBe(1000);
    expect(cues[0]?.endMs).toBe(2000);
    expect(cues[0]?.text).toBe('Positioned cue.');
  });

  it('handles a cue identifier line before the timing line', () => {
    const vtt = ['WEBVTT', '', 'cue-1', '00:00:01.000 --> 00:00:02.000', 'Identified cue.', ''].join('\n');
    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0]?.text).toBe('Identified cue.');
  });

  it('strips <v Speaker> and <c> tags', () => {
    const vtt = ['WEBVTT', '', '00:00:01.000 --> 00:00:02.000', '<v Alice>Hello <c.yellow>world</c></v>', ''].join(
      '\n'
    );
    const cues = parseVtt(vtt);
    expect(cues[0]?.text).toBe('Hello world');
  });

  it('joins multi-line cue text with a single space', () => {
    const vtt = ['WEBVTT', '', '00:00:01.000 --> 00:00:04.000', 'Line one', 'Line two', ''].join('\n');
    const cues = parseVtt(vtt);
    expect(cues[0]?.text).toBe('Line one Line two');
  });
});

describe('parseSubtitles', () => {
  it('autodetects VTT from the WEBVTT header', () => {
    const vtt = ['WEBVTT', '', '00:00:01.000 --> 00:00:02.000', 'Hi.', ''].join('\n');
    expect(parseSubtitles(vtt)).toHaveLength(1);
  });

  it('autodetects SRT when there is no WEBVTT header', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nHi.\n';
    expect(parseSubtitles(srt)).toHaveLength(1);
  });

  it('respects an explicit format override', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nHi.\n';
    expect(parseSubtitles(srt, 'srt')).toHaveLength(1);
  });

  it('autodetects VTT even with a BOM before the header', () => {
    const vtt = '﻿WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi.\n';
    expect(parseSubtitles(vtt)).toHaveLength(1);
  });
});
