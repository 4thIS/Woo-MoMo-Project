import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// 워커는 로컬 번들에서 로드한다 — CDN 없음, 이력서가 밖으로 나가지 않는다.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export async function extractPdfText(file: File): Promise<string> {
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() })
  const pages: string[] = []
  try {
    const doc = await loadingTask.promise
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent()
      pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '))
    }
  } finally {
    await loadingTask.destroy()
  }
  return pages.join('\n')
}
