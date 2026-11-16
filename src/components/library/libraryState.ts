import { create } from 'zustand'

/** 素材库弹窗：侧边栏入口与移动端抽屉都可以打开 */
export const useLibraryDialog = create(() => ({ open: false }))

export const openLibrary = () => useLibraryDialog.setState({ open: true })

export const closeLibrary = () => useLibraryDialog.setState({ open: false })
