/** 스프라이트 이미지가 실제로 뜨는지 확인한다(없는 파일·깨진 PNG면 false) */
export function probeImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth > 0)
    img.onerror = () => resolve(false)
    img.src = url
  })
}
