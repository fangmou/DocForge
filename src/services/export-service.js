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

/**
 * 导出 HTML
 * @param {string} content - adoc 内容
 * @param {string} sourcePath - 源文件路径
 * output_dir / output_naming 配置同时控制 HTML 和 PDF
 */
export async function exportToHtml(content, sourcePath) {
  const adoc = await getAsciidoctor();
  // 解析 include 指令
  let resolved = content;
  if (sourcePath && !sourcePath.startsWith('__untitled_') && content.includes('include::')) {
    try {
      const dir = sourcePath.replace(/\/[^/]+$/, '');
      resolved = await resolveIncludes(content, dir);
    } catch (_) {}
  }

  // 加载 extraArgs
  let extraArgs = '';
  try {
    const pdfConfig = await invoke()('load_pdf_config');
    extraArgs = (pdfConfig && pdfConfig.extra_args) || '';
  } catch (_) {}

  const baseAttrs = {
    showtitle: true,
    toc: 'auto',
    'source-highlighter': 'highlight.js',
    sectanchors: '',
    icons: 'font',
  };
  const attrs = buildAttributes(resolved, baseAttrs, extraArgs);

  const html = adoc.convert(resolved, {
    safe: 'safe',
    standalone: false,
    attributes: attrs,
  });

  // 加载导出配置
  let outputDir = '';
  let outputNaming = 'title';
  try {
    const pdfConfig = await invoke()('load_pdf_config');
    outputDir = (pdfConfig && pdfConfig.output_dir) || '';
    outputNaming = (pdfConfig && pdfConfig.output_naming) || 'stem';
  } catch (_) {}

  // 决定输出文件名
  const fileStem = sourcePath
    ? sourcePath.replace(/.*\//, '').replace(/\.[^.]+$/, '')
    : 'export';

  let name;
  if (outputNaming === 'title') {
    name = extractDocTitle(content) || fileStem;
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

export async function exportToPdf(sourcePath) {
  return invoke()('export_to_pdf', { sourcePath });
}

export async function openInBrowser(htmlContent) {
  return invoke()('open_in_browser', { htmlContent });
}

export async function resolveIncludes(content, baseDir) {
  return invoke()('resolve_includes', { content, baseDir });
}
