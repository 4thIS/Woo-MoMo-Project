const GB = 1024 ** 3

export function formatGB(bytes: number): string {
  return `약 ${(bytes / GB).toFixed(1)}GB`
}

export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(1)} KB`
}
