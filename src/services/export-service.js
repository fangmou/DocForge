const invoke = () => window.__TAURI__.core.invoke;

import { buildAttributes } from './asciidoc-attrs.js';

let asciidoctor = null;

async function getAsciidoctor() {
  if (!asciidoctor) {
    const module = await import('@asciidoctor/core');
    asciidoctor = module.default();
  }
  return asciidoctor;
}

/** 从 adoc 内容提取文档标题（第一个 `= Title` 行），空格替换为下划线 */
function extractDocTitle(content) {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    const m = trimmed.match(/^=\s+(.+)/);
    if (m) {
      const title = m[1].trim();
      if (title) return title.replace(/[\s/\\]+/g, '_');
    }
    if (trimmed && !trimmed.startsWith('//')) break;
  }
  return null;
}

/** 从 Markdown 内容提取文档标题（第一个 `# Title` 行），空格替换为下划线 */
function extractMdTitle(content) {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    const m = trimmed.match(/^#\s+(.+)/);
    if (m) {
      const title = m[1].trim();
      if (title) return title.replace(/[\s/\\]+/g, '_');
    }
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---') && !trimmed.startsWith('<!--')) break;
  }
  return null;
}

/**
 * 导出 HTML
 * @param {string} content - 文档内容（AsciiDoc 或 Markdown）
 * @param {string} sourcePath - 源文件路径
 */
export async function exportToHtml(content, sourcePath) {
  const isMd = sourcePath && /\.(md|markdown)$/i.test(sourcePath);

  let html;
  if (isMd) {
    const { marked } = await import('marked');
    html = marked.parse(content);
  } else {
    const adoc = await getAsciidoctor();
    // 解析 include 指令
    let resolved = content;
    if (sourcePath && !sourcePath.startsWith('__untitled_') && content.includes('include::')) {
      try {
        const dir = sourcePath.replace(/\/[^/]+$/, '');
        resolved = await resolveIncludes(content, dir);
      } catch (_) {}
    }

    // 加载 asciidoc 引擎配置获取 extra_args
    let extraArgs = '';
    try {
      const asciidocConfig = await invoke()('load_asciidoc_export_config');
      extraArgs = (asciidocConfig && asciidocConfig.extra_args) || '';
    } catch (_) {}

    const baseAttrs = {
      showtitle: true,
      toc: 'auto',
      'source-highlighter': 'highlight.js',
      sectanchors: '',
      icons: 'font',
    };
    const attrs = buildAttributes(resolved, baseAttrs, extraArgs);

    html = adoc.convert(resolved, {
      safe: 'safe',
      standalone: false,
      attributes: attrs,
    });
  }

  // 加载导出通用配置
  let outputDir = '';
  let outputNaming = 'title';
  try {
    const exportConfig = await invoke()('load_export_config');
    outputDir = (exportConfig && exportConfig.output_dir) || '';
    outputNaming = (exportConfig && exportConfig.output_naming) || 'title';
  } catch (_) {}

  // 决定输出文件名
  const fileStem = sourcePath
    ? sourcePath.replace(/.*\//, '').replace(/\.[^.]+$/, '')
    : 'export';

  let name;
  if (outputNaming === 'title') {
    name = isMd
      ? extractMdTitle(content) || fileStem
      : extractDocTitle(content) || fileStem;
  } else {
    name = fileStem;
  }

  let destPath;
  if (outputDir) {
    destPath = `${outputDir.replace(/\/$/, '')}/${name}.html`;
  } else if (sourcePath && !sourcePath.startsWith('__untitled_')) {
    const dir = sourcePath.replace(/\/[^/]+$/, '');
    destPath = `${dir}/${name}.html`;
  } else {
    const picked = await invoke()('pick_save_path', { fileName: `${name}.html` });
    if (!picked) return null;
    destPath = picked;
  }

  return invoke()('save_rendered_html', { htmlContent: html, destPath });
}

export async function checkAsciidoctorPdf() {
  return invoke()('check_asciidoctor_pdf');
}

export async function detectPdfCommand() {
  return invoke()('detect_pdf_command');
}

export async function exportToPdf(sourcePath) {
  return invoke()('export_to_pdf', { sourcePath });
}

export async function checkPandoc() {
  return invoke()('check_pandoc');
}

export async function detectPandocCommand() {
  return invoke()('detect_pandoc_command');
}

export async function exportToDocx(sourcePath) {
  return invoke()('export_to_docx', { sourcePath });
}

export async function openInBrowser(htmlContent) {
  return invoke()('open_in_browser', { htmlContent });
}

export async function resolveIncludes(content, baseDir) {
  return invoke()('resolve_includes', { content, baseDir });
}

export async function pickDocxFile() {
  return invoke()('pick_docx_file');
}

export async function importDocx(docxPath, destDir) {
  return invoke()('import_docx', { docxPath, destDir });
}

/** 解析导出路径（自动双向转换：Windows ↔ /mnt/...） */
export async function resolveExportPath(path) {
  return invoke()('resolve_export_path', { path });
}
