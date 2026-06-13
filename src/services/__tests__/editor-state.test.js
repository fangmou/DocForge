import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState, untitledName } from '../editor-state.js';

describe('untitledName', () => {
  it('extracts number from untitled path', () => {
    expect(untitledName('__untitled_3_abc')).toBe('untitled-3.adoc');
  });

  it('returns default for non-untitled path', () => {
    expect(untitledName('some_other_path')).toBe('untitled.adoc');
  });

  it('returns default for empty string', () => {
    expect(untitledName('')).toBe('untitled.adoc');
  });
});

describe('EditorState', () => {
  let state;

  beforeEach(() => {
    state = new EditorState();
  });

  // ─── openFile ───

  it('opens a file and sets it active', () => {
    state.openFile('/ws/file.adoc', 'content');
    expect(state.activeFilePath).toBe('/ws/file.adoc');
    expect(state.files.has('/ws/file.adoc')).toBe(true);
    const file = state.getFile('/ws/file.adoc');
    expect(file.content).toBe('content');
    expect(file.isDirty).toBe(false);
    expect(file.scrollTop).toBe(0);
    expect(file.cursorPos).toBe(0);
  });

  it('opening same file twice does not duplicate tab', () => {
    state.openFile('/ws/a.adoc', 'a');
    state.openFile('/ws/a.adoc', 'a-updated');
    expect(state.tabOrder.length).toBe(1);
    expect(state.files.get('/ws/a.adoc').content).toBe('a');
  });

  it('opening multiple files preserves order', () => {
    state.openFile('/ws/a.adoc', 'a');
    state.openFile('/ws/b.adoc', 'b');
    state.openFile('/ws/c.adoc', 'c');
    expect(state.tabOrder).toEqual(['/ws/a.adoc', '/ws/b.adoc', '/ws/c.adoc']);
    expect(state.activeFilePath).toBe('/ws/c.adoc');
  });

  // ─── closeFile ───

  it('closing last file sets active to null', () => {
    state.openFile('/ws/a.adoc', 'a');
    state.closeFile('/ws/a.adoc');
    expect(state.activeFilePath).toBeNull();
    expect(state.tabOrder).toEqual([]);
  });

  it('closing active file switches to adjacent', () => {
    state.openFile('/ws/a.adoc', 'a');
    state.openFile('/ws/b.adoc', 'b');
    state.openFile('/ws/c.adoc', 'c');
    // active is c, close b (not active)
    state.closeFile('/ws/b.adoc');
    expect(state.activeFilePath).toBe('/ws/c.adoc');
    expect(state.tabOrder).toEqual(['/ws/a.adoc', '/ws/c.adoc']);
  });

  it('closing active middle file switches to previous', () => {
    state.openFile('/ws/a.adoc', 'a');
    state.openFile('/ws/b.adoc', 'b');
    state.openFile('/ws/c.adoc', 'c');
    // Make b active, then close it
    state.setActiveFile('/ws/b.adoc');
    state.closeFile('/ws/b.adoc');
    // tabOrder filter 先执行，indexOf 在 filter 后的数组里找 b 为 -1
    // Math.min(-1, 1) = -1, Math.max(0, -1) = 0 → 跳到 a
    expect(state.activeFilePath).toBe('/ws/a.adoc');
  });

  it('closing last active file switches to previous', () => {
    state.openFile('/ws/a.adoc', 'a');
    state.openFile('/ws/b.adoc', 'b');
    // active is b, close it
    state.closeFile('/ws/b.adoc');
    expect(state.activeFilePath).toBe('/ws/a.adoc');
  });

  // ─── updateContent / markSaved ───

  it('updateContent marks file dirty', () => {
    state.openFile('/ws/a.adoc', 'original');
    state.updateContent('/ws/a.adoc', 'modified');
    expect(state.getFile('/ws/a.adoc').isDirty).toBe(true);
    expect(state.getFile('/ws/a.adoc').content).toBe('modified');
  });

  it('updateContent with same content does not mark dirty', () => {
    state.openFile('/ws/a.adoc', 'same');
    state.updateContent('/ws/a.adoc', 'same');
    expect(state.getFile('/ws/a.adoc').isDirty).toBe(false);
  });

  it('markSaved clears dirty flag', () => {
    state.openFile('/ws/a.adoc', 'original');
    state.updateContent('/ws/a.adoc', 'modified');
    state.markSaved('/ws/a.adoc');
    expect(state.getFile('/ws/a.adoc').isDirty).toBe(false);
  });

  // ─── getDirtyFiles ───

  it('getDirtyFiles returns only dirty paths', () => {
    state.openFile('/ws/a.adoc', 'a');
    state.openFile('/ws/b.adoc', 'b');
    state.updateContent('/ws/a.adoc', 'a-mod');
    expect(state.getDirtyFiles()).toEqual(['/ws/a.adoc']);
  });

  // ─── getOpenFiles ───

  it('getOpenFiles returns tab-ordered file info', () => {
    state.openFile('/ws/alpha.adoc', 'a');
    state.openFile('__untitled_1_temp', 'untitled');
    const openFiles = state.getOpenFiles();
    expect(openFiles.length).toBe(2);
    expect(openFiles[0].name).toBe('alpha.adoc');
    expect(openFiles[0].path).toBe('/ws/alpha.adoc');
    expect(openFiles[1].name).toBe('untitled-1.adoc');
  });

  // ─── renameFile ───

  it('renameFile updates path in files map, tab order, and active', () => {
    state.openFile('/ws/old.adoc', 'content');
    state.renameFile('/ws/old.adoc', '/ws/new.adoc');
    expect(state.files.has('/ws/old.adoc')).toBe(false);
    expect(state.files.has('/ws/new.adoc')).toBe(true);
    expect(state.activeFilePath).toBe('/ws/new.adoc');
    expect(state.tabOrder).toEqual(['/ws/new.adoc']);
    expect(state.getFile('/ws/new.adoc').content).toBe('content');
  });

  it('renameFile on non-existent file is no-op', () => {
    state.renameFile('/ws/none.adoc', '/ws/new.adoc');
    expect(state.files.has('/ws/new.adoc')).toBe(false);
  });

  // ─── reorderTab ───

  it('reorderTab swaps tab positions', () => {
    state.openFile('/ws/a.adoc', 'a');
    state.openFile('/ws/b.adoc', 'b');
    state.openFile('/ws/c.adoc', 'c');
    state.reorderTab('/ws/a.adoc', '/ws/c.adoc');
    expect(state.tabOrder).toEqual(['/ws/b.adoc', '/ws/c.adoc', '/ws/a.adoc']);
  });

  it('reorderTab with invalid paths is no-op', () => {
    state.openFile('/ws/a.adoc', 'a');
    state.reorderTab('/ws/none.adoc', '/ws/a.adoc');
    expect(state.tabOrder).toEqual(['/ws/a.adoc']);
  });

  // ─── setActiveFile ───

  it('setActiveFile changes active', () => {
    state.openFile('/ws/a.adoc', 'a');
    state.openFile('/ws/b.adoc', 'b');
    state.setActiveFile('/ws/a.adoc');
    expect(state.activeFilePath).toBe('/ws/a.adoc');
  });

  it('setActiveFile to same path is no-op', () => {
    state.openFile('/ws/a.adoc', 'a');
    const before = state.activeFilePath;
    state.setActiveFile('/ws/a.adoc');
    expect(state.activeFilePath).toBe(before);
  });

  // ─── serialize / deserialize ───

  describe('serialize / deserialize', () => {
    it('round-trips state without content', () => {
      state.openFile('/ws/a.adoc', 'content-a');
      state.openFile('/ws/b.adoc', 'content-b');
      state.updateContent('/ws/a.adoc', 'dirty-a');
      state.setActiveFile('/ws/b.adoc');

      const serialized = state.serialize();
      expect(serialized.tabs.length).toBe(2);
      expect(serialized.tabs[0].isDirty).toBe(true);
      expect(serialized.activeFilePath).toBe('/ws/b.adoc');
      // content is NOT serialized
      expect(serialized.tabs[0].content).toBeUndefined();

      const state2 = new EditorState();
      state2.deserialize(serialized);
      expect(state2.activeFilePath).toBe('/ws/b.adoc');
      expect(state2.getFile('/ws/a.adoc').content).toBe('');
      expect(state2.getFile('/ws/a.adoc').isDirty).toBe(true);
    });

    it('deserialize handles snake_case keys (from Rust backend)', () => {
      const data = {
        tabs: [{ path: '/ws/a.adoc', scroll_top: 10, cursor_pos: 5, is_dirty: true }],
        active_file_path: '/ws/a.adoc',
      };
      state.deserialize(data);
      expect(state.getFile('/ws/a.adoc').scrollTop).toBe(10);
      expect(state.getFile('/ws/a.adoc').cursorPos).toBe(5);
      expect(state.getFile('/ws/a.adoc').isDirty).toBe(true);
    });

    it('deserialize handles camelCase keys', () => {
      const data = {
        tabs: [{ path: '/ws/a.adoc', scrollTop: 20, cursorPos: 15, isDirty: false }],
        activeFilePath: '/ws/a.adoc',
      };
      state.deserialize(data);
      expect(state.getFile('/ws/a.adoc').scrollTop).toBe(20);
      expect(state.getFile('/ws/a.adoc').isDirty).toBe(false);
    });

    it('deserialize with null data clears state', () => {
      state.openFile('/ws/a.adoc', 'a');
      state.deserialize(null);
      expect(state.files.size).toBe(0);
      expect(state.tabOrder).toEqual([]);
      expect(state.activeFilePath).toBeNull();
    });
  });

  // ─── onChange ───

  it('onChange listener fires on state changes', () => {
    const changes = [];
    state.onChange((s) => changes.push(s.activeFilePath));
    state.openFile('/ws/a.adoc', 'a');
    state.updateContent('/ws/a.adoc', 'mod');
    expect(changes).toEqual(['/ws/a.adoc', '/ws/a.adoc']);
  });

  it('onChange unsubscribe stops notifications', () => {
    const changes = [];
    const unsub = state.onChange((s) => changes.push(1));
    unsub();
    state.openFile('/ws/a.adoc', 'a');
    expect(changes).toEqual([]);
  });
});
