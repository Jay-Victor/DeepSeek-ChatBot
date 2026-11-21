import { create } from 'zustand'

/**
 * 顶栏身份切换菜单的开合状态。
 * owner 是实例 id：只有打开它的那个顶栏能关闭它，卸载时不会误关别处的菜单。
 */
type IdentitySwitcherState = {
  open: boolean
  owner: string | null
}

export const useIdentitySwitcher = create<IdentitySwitcherState>(() => ({
  open: false,
  owner: null,
}))

export const openIdentitySwitcher = (owner: string) =>
  useIdentitySwitcher.setState({ open: true, owner })

export const closeIdentitySwitcher = (owner?: string) => {
  useIdentitySwitcher.setState((state) =>
    state.open && (!owner || state.owner === owner) ? { open: false, owner: null } : state
  )
}
