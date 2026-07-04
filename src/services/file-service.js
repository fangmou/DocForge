const invoke = () => window.__TAURI__.core.invoke;

export async function readFile(path) {
  return invoke()('read_file', { path });
}

export async function readBinaryFile(path) {
  return invoke()('read_binary_file', { path });
}

export async function writeFile(path, content) {
  return invoke()('write_file', { path, content });
}

export async function listDirectory(path, showHidden) {
  const payload = { path };
  if (showHidden) payload.showHidden = true;
  return invoke()('list_directory', payload);
}

export async function listSubDirectory(path, showHidden) {
  const payload = { path };
  if (showHidden) payload.showHidden = true;
  return invoke()('list_sub_directory', payload);
}

export async function pickDirectory() {
  return invoke()('pick_directory');
}

export async function createFile(path) {
  return invoke()('create_file', { path });
}

export async function deleteFile(path) {
  return invoke()('delete_file', { path });
}

export async function renameFile(oldPath, newPath) {
  return invoke()('rename_file', { oldPath, newPath });
}

export async function createDir(path) {
  return invoke()('create_dir', { path });
}

export async function pickSaveFile(dir, fileName) {
  return invoke()('pick_save_file', { dir, fileName });
}

export async function getFileMtime(path) {
  return invoke()('get_file_mtime', { path });
}

export async function listAllAdocFiles(path) {
  return invoke()('list_all_adoc_files', { path });
}
