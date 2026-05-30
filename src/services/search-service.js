const invoke = () => window.__TAURI__.core.invoke;

export async function searchFiles(directory, query, caseSensitive = false) {
  return invoke()('search_files', { directory, query, caseSensitive });
}
