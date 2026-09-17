const GB = 1024 ** 3

export function formatGB(bytes: number): string {
  return `약 ${(bytes / GB).toFixed(1)}GB`
}

export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(1)} KB`
}

/** 동의 창·장비 확인 공용: 1GiB 이상은 "약 2.8GB", 미만은 "약 380MB" (둘 다 1024 기준) */
export function formatSize(bytes: number): string {
  return bytes >= GB ? formatGB(bytes) : `약 ${Math.round(bytes / 1024 ** 2)}MB`
}
