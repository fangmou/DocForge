import { describe, it, expect } from 'vitest';
import { isBinaryFile, getFileCategory, getFormat } from '../format-commands.js';

describe('isBinaryFile', () => {
  it('detects image files', () => {
    expect(isBinaryFile('photo.png')).toBe(true);
    expect(isBinaryFile('photo.jpg')).toBe(true);
    expect(isBinaryFile('photo.jpeg')).toBe(true);
    expect(isBinaryFile('photo.gif')).toBe(true);
    expect(isBinaryFile('photo.webp')).toBe(true);
    expect(isBinaryFile('photo.bmp')).toBe(true);
    // svg 在 getFileCategory 中单独判断，不在 BINARY_EXTS 中
  });

  it('detects audio files', () => {
    expect(isBinaryFile('song.mp3')).toBe(true);
    expect(isBinaryFile('song.wav')).toBe(true);
    expect(isBinaryFile('song.ogg')).toBe(true);
    expect(isBinaryFile('song.flac')).toBe(true);
  });

  it('detects video files', () => {
    expect(isBinaryFile('video.mp4')).toBe(true);
    expect(isBinaryFile('video.webm')).toBe(true);
    expect(isBinaryFile('video.mkv')).toBe(true);
  });

  it('detects pdf', () => {
    expect(isBinaryFile('doc.pdf')).toBe(true);
  });

  it('returns false for text files', () => {
    expect(isBinaryFile('doc.adoc')).toBe(false);
    expect(isBinaryFile('doc.md')).toBe(false);
    expect(isBinaryFile('doc.txt')).toBe(false);
    expect(isBinaryFile('doc.html')).toBe(false);
    expect(isBinaryFile('script.js')).toBe(false);
  });

  it('returns false for null/empty', () => {
    expect(isBinaryFile('')).toBe(false);
    expect(isBinaryFile(null)).toBe(false);
    expect(isBinaryFile(undefined)).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isBinaryFile('photo.PNG')).toBe(true);
    expect(isBinaryFile('photo.Jpeg')).toBe(true);
    expect(isBinaryFile('doc.PDF')).toBe(true);
  });

  it('handles paths with directories', () => {
    expect(isBinaryFile('/home/user/docs/image.png')).toBe(true);
    expect(isBinaryFile('/home/user/docs/file.adoc')).toBe(false);
  });
});

describe('getFileCategory', () => {
  it('returns markup for adoc/md', () => {
    expect(getFileCategory('doc.adoc')).toBe('markup');
    expect(getFileCategory('doc.asciidoc')).toBe('markup');
    expect(getFileCategory('doc.md')).toBe('markup');
    expect(getFileCategory('doc.markdown')).toBe('markup');
  });

  it('returns svg', () => {
    expect(getFileCategory('diagram.svg')).toBe('svg');
  });

  it('returns image', () => {
    expect(getFileCategory('photo.png')).toBe('image');
    expect(getFileCategory('photo.jpg')).toBe('image');
  });

  it('returns audio', () => {
    expect(getFileCategory('song.mp3')).toBe('audio');
  });

  it('returns video', () => {
    expect(getFileCategory('video.mp4')).toBe('video');
  });

  it('returns pdf', () => {
    expect(getFileCategory('doc.pdf')).toBe('pdf');
  });

  it('returns html', () => {
    expect(getFileCategory('page.html')).toBe('html');
    expect(getFileCategory('page.htm')).toBe('html');
  });

  it('returns text for unknown extensions', () => {
    expect(getFileCategory('script.js')).toBe('text');
    expect(getFileCategory('style.css')).toBe('text');
    expect(getFileCategory('data.json')).toBe('text');
  });

  it('returns unknown for null/empty', () => {
    expect(getFileCategory('')).toBe('unknown');
    expect(getFileCategory(null)).toBe('unknown');
    expect(getFileCategory(undefined)).toBe('unknown');
  });
});

describe('getFormat', () => {
  it('returns adoc format for .adoc files', () => {
    const fmt = getFormat('doc.adoc');
    expect(fmt).not.toBeNull();
    expect(fmt.id).toBe('adoc');
  });

  it('returns adoc format for .asciidoc files', () => {
    const fmt = getFormat('doc.asciidoc');
    expect(fmt).not.toBeNull();
    expect(fmt.id).toBe('adoc');
  });

  it('returns md format for .md files', () => {
    const fmt = getFormat('doc.md');
    expect(fmt).not.toBeNull();
    expect(fmt.id).toBe('md');
  });

  it('returns md format for .markdown files', () => {
    const fmt = getFormat('doc.markdown');
    expect(fmt).not.toBeNull();
    expect(fmt.id).toBe('md');
  });

  it('returns null for non-markup files', () => {
    expect(getFormat('script.js')).toBeNull();
    expect(getFormat('style.css')).toBeNull();
    expect(getFormat('data.json')).toBeNull();
    expect(getFormat('image.png')).toBeNull();
  });

  it('returns null for null/empty', () => {
    expect(getFormat('')).toBeNull();
    expect(getFormat(null)).toBeNull();
  });

  it('adoc format has expected structure', () => {
    const fmt = getFormat('doc.adoc');
    expect(fmt.inlineMarkup.length).toBeGreaterThan(0);
    expect(fmt.heading).toBeDefined();
    expect(fmt.heading.prefix(1)).toBe('= ');
    expect(fmt.heading.prefix(2)).toBe('== ');
    expect(fmt.listMarkers.length).toBeGreaterThan(0);
    expect(fmt.comment).toBeDefined();
    expect(fmt.blocks.length).toBeGreaterThan(0);
  });

  it('md format has expected structure', () => {
    const fmt = getFormat('doc.md');
    expect(fmt.inlineMarkup.length).toBeGreaterThan(0);
    expect(fmt.heading.prefix(1)).toBe('# ');
    expect(fmt.heading.prefix(3)).toBe('### ');
    expect(fmt.listMarkers.length).toBeGreaterThan(0);
    expect(fmt.comment).toBeDefined();
  });
});
