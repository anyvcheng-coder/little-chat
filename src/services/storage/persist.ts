/**
 * 申请持久化存储：会话、附件与生成的图片都只存在本机，
 * 拿到持久化授权后系统在空间紧张时不会静默清理。
 */
export const requestPersistentStorage = async (): Promise<boolean> => {
  if (!navigator.storage?.persist) {
    return false
  }
  try {
    if (await navigator.storage.persisted()) {
      return true
    }
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
